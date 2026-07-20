import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Interface } from 'node:readline'
import type { HelperCommand, HelperEvent } from './helper-protocol'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { parseHelperEvent, PROTOCOL_VERSION } from './helper-protocol'
import { decodePcm16, SileroVad } from './silero-vad'

// Messages between the extension host and this worker thread.
export interface WorkerData {
  /** Absolute path to the native capture helper executable. */
  helperPath: string
  /** Absolute path to the Silero VAD ONNX model shipped with `@ricky0123/vad-web`. */
  vadModelPath: string
  /** Hugging Face model id for the ASR pipeline. */
  modelId: string
  /** Quantization dtype passed to the pipeline (e.g. `q4f16`). */
  dtype: string
  /** Directory Transformers.js should use to cache model files. */
  cacheDir: string
}

export type WorkerCommand
  = | { type: 'start', sessionId: string, language: string }
    | { type: 'stop', sessionId: string }
    | { type: 'cancel', sessionId: string }

export type WorkerEvent
  = | { type: 'modelProgress', message: string }
    | { type: 'recording', sessionId: string }
    | { type: 'partial', sessionId: string, text: string }
    | { type: 'final', sessionId: string, text: string }
    | { type: 'cancelled', sessionId: string }
    | { type: 'error', code: string, message: string, sessionId?: string }

type Transcribe = (audio: Float32Array, language: string) => Promise<string>

class TranscriptionSession {
  private readonly buffer: number[] = []

  constructor(
    readonly sessionId: string,
    private readonly language: string,
    private readonly transcribe: Transcribe,
    private readonly extractSpeech: (audio: Float32Array) => Promise<Float32Array>,
    private readonly emit: (event: WorkerEvent) => void,
  ) {}

  addPcm(base64: string): void {
    const samples = decodePcm16(base64)
    for (let i = 0; i < samples.length; i++)
      this.buffer.push(samples[i] ?? 0)
  }

  /**
   * Capture has ended. Strip non-speech with Silero VAD, then transcribe the
   * remaining audio once for the authoritative final transcript.
   */
  async finalize(): Promise<void> {
    const audio = Float32Array.from(this.buffer)
    if (audio.length === 0) {
      this.emit({ type: 'final', sessionId: this.sessionId, text: '' })
      return
    }

    const speech = await this.extractSpeech(audio)
    if (speech.length === 0) {
      this.emit({ type: 'final', sessionId: this.sessionId, text: '' })
      return
    }

    const text = (await this.transcribe(speech, this.language)).trim()
    this.emit({ type: 'final', sessionId: this.sessionId, text })
  }
}

class Worker {
  private child: ChildProcessWithoutNullStreams | undefined
  private lines: Interface | undefined
  private session: TranscriptionSession | undefined
  private transcriber: Transcribe | undefined
  private vad: SileroVad | undefined
  private helloResolve: (() => void) | undefined
  private readonly cancelledSessions = new Set<string>()

  constructor(
    private readonly data: WorkerData,
    private readonly emit: (event: WorkerEvent) => void,
  ) {}

  async handle(command: WorkerCommand): Promise<void> {
    switch (command.type) {
      case 'start':
        await this.start(command.sessionId, command.language)
        break
      case 'stop':
        this.stop(command.sessionId)
        break
      case 'cancel':
        this.cancel(command.sessionId)
        break
    }
  }

  private async start(sessionId: string, language: string): Promise<void> {
    try {
      const transcribe = await this.ensureTranscriber()
      const extractSpeech = await this.ensureSpeechExtractor()
      await this.ensureHelper()
      this.session = new TranscriptionSession(sessionId, language, transcribe, extractSpeech, this.emit)
      this.send({ type: 'start', sessionId })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'error', code: 'start_failed', message, sessionId })
    }
  }

  private stop(sessionId: string): void {
    if (!this.session || this.session.sessionId !== sessionId)
      return
    this.send({ type: 'stop', sessionId })
  }

  private cancel(sessionId: string): void {
    if (!this.session || this.session.sessionId !== sessionId)
      return
    this.send({ type: 'cancel', sessionId })
  }

  private async ensureTranscriber(): Promise<Transcribe> {
    if (this.transcriber)
      return this.transcriber

    const stub = process.env.COPILOT_SPEECH_STUB_TRANSCRIPT
    if (stub !== undefined) {
      this.transcriber = async () => stub
      return this.transcriber
    }

    this.emit({ type: 'modelProgress', message: 'Loading speech model…' })
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = this.data.cacheDir
    const asr = await pipeline('automatic-speech-recognition', this.data.modelId, {
      dtype: this.data.dtype as 'q4f16',
      progress_callback: (progress: { status?: string, file?: string, progress?: number }) => {
        if (progress.status === 'progress' && progress.file !== undefined && progress.file !== '')
          this.emit({ type: 'modelProgress', message: `${progress.file}: ${Math.floor(progress.progress ?? 0)}%` })
      },
    })
    this.transcriber = async (audio, language) => {
      const output = await asr(audio, { language, max_new_tokens: 512 }) as
        | { text?: string }
        | Array<{ text?: string }>
      const result = Array.isArray(output) ? output[0] : output
      return result?.text ?? ''
    }
    return this.transcriber
  }

  private async ensureSpeechExtractor(): Promise<(audio: Float32Array) => Promise<Float32Array>> {
    const stub = process.env.COPILOT_SPEECH_STUB_TRANSCRIPT
    if (stub !== undefined)
      return async audio => audio

    if (!this.vad) {
      this.emit({ type: 'modelProgress', message: 'Loading voice activity model…' })
      this.vad = await SileroVad.create(this.data.vadModelPath)
    }
    return async audio => this.vad!.extractSpeech(audio)
  }

  private async ensureHelper(): Promise<void> {
    if (this.child && !this.child.killed)
      return
    const child = spawn(this.data.helperPath, ['--stdio'], { stdio: 'pipe', windowsHide: true })
    this.child = child
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', line => this.handleHelperLine(line))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean))
        this.emit({ type: 'error', code: 'helper_stderr', message: line })
    })
    child.on('exit', (code, signal) => {
      this.child = undefined
      this.lines?.close()
      this.lines = undefined
      if (this.session) {
        this.emit({
          type: 'error',
          code: 'helper_failure',
          message: `Native helper exited with code ${code ?? 'none'} and signal ${signal ?? 'none'}.`,
          sessionId: this.session.sessionId,
        })
        this.session = undefined
      }
    })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for the native helper handshake.')), 5000)
      this.helloResolve = () => {
        clearTimeout(timeout)
        resolve()
      }
      this.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION })
    })
  }

  private handleHelperLine(line: string): void {
    if (Buffer.byteLength(line, 'utf8') > 2 * 1024 * 1024)
      return
    let event: HelperEvent
    try {
      event = parseHelperEvent(line)
    }
    catch {
      return
    }
    void this.handleHelperEvent(event)
  }

  private async handleHelperEvent(event: HelperEvent): Promise<void> {
    switch (event.type) {
      case 'hello':
        if (event.protocolVersion !== PROTOCOL_VERSION) {
          this.emit({ type: 'error', code: 'protocol_mismatch', message: `Native helper protocol ${event.protocolVersion} is incompatible with extension protocol ${PROTOCOL_VERSION}.` })
          return
        }
        this.helloResolve?.()
        break
      case 'recording':
        this.emit({ type: 'recording', sessionId: event.sessionId })
        break
      case 'pcm':
        this.session?.addPcm(event.data)
        break
      case 'stopped':
        await this.completeSession(event.sessionId)
        break
      case 'error':
        this.emit({ type: 'error', code: event.code, message: event.message, ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }) })
        this.session = undefined
        break
    }
  }

  private async completeSession(sessionId: string): Promise<void> {
    const session = this.session
    if (!session || session.sessionId !== sessionId)
      return
    this.session = undefined
    if (this.cancelledSessions.delete(sessionId)) {
      this.emit({ type: 'cancelled', sessionId })
      return
    }
    try {
      await session.finalize()
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'error', code: 'transcription_failed', message, sessionId })
    }
  }

  private send(command: HelperCommand): void {
    if (command.type === 'cancel')
      this.cancelledSessions.add(command.sessionId)
    if (!this.child || this.child.killed || !this.child.stdin.writable)
      return
    this.child.stdin.write(`${JSON.stringify(command)}\n`)
  }

  dispose(): void {
    if (this.child && !this.child.killed)
      this.child.kill()
    this.lines?.close()
  }
}

if (!isMainThread && parentPort) {
  const port = parentPort
  const worker = new Worker(workerData as WorkerData, event => port.postMessage(event))
  port.on('message', (command: WorkerCommand) => void worker.handle(command))
  port.on('close', () => worker.dispose())
}
