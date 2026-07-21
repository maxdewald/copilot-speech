import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Interface } from 'node:readline'
import type { HelperCommand, HelperEvent } from './helper-protocol'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { parseHelperEvent, PROTOCOL_VERSION } from './helper-protocol'
import { decodePcm16, openEndpointer, SileroEndpointer, SileroVad } from './silero-vad'

const SAMPLE_RATE = 16000
/** Minimum time between preview ASR starts. */
const PREVIEW_INTERVAL_MS = 1000
/** Stop recording and finalize after this much continuous non-speech. */
export const SILENCE_AUTO_STOP_MS = 5000
const MIN_SPEECH_SAMPLES = Math.floor(0.45 * SAMPLE_RATE)
const MAX_PREVIEW_SAMPLES = 20 * SAMPLE_RATE

function cleanStalePartialDownloads(dir: string): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  }
  catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(full)
    }
    catch {
      continue
    }
    if (stat.isDirectory()) {
      cleanStalePartialDownloads(full)
    }
    else if (/\.tmp\.[^/]+$/.test(name)) {
      try {
        rmSync(full, { force: true })
      }
      catch {
      }
    }
  }
}

export interface WorkerData {
  helperPath: string
  vadModelPath: string
  modelId: string
  dtype: string
  cacheDir: string
}

export type WorkerCommand
  = | { type: 'start', sessionId: string, language: string }
    | { type: 'stop', sessionId: string }
    | { type: 'cancel', sessionId: string }

export type WorkerEvent
  = | { type: 'modelProgress', message: string, file?: string, loaded?: number, total?: number }
    | { type: 'recording', sessionId: string }
    | { type: 'partial', sessionId: string, text: string }
    | { type: 'final', sessionId: string, text: string }
    | { type: 'cancelled', sessionId: string }
    | { type: 'error', code: string, message: string, sessionId?: string }

type Transcribe = (audio: Float32Array, language: string) => Promise<string>

/** Duck-typed pause gate used by previews (SileroEndpointer or openEndpointer stub). */
export interface PreviewEndpointer {
  speaking: boolean
  push: (samples: Float32Array) => Promise<{ speaking: boolean, speechEnded: boolean }>
  reset: () => void
}

/** Exported for unit tests with an injected endpointer. */
export class TranscriptionSession {
  private readonly buffer: number[] = []
  private previewsClosed = false
  private previewInFlight = false
  /** True only after Silero reports SpeechEnd until that segment is previewed once. */
  private previewPending = false
  private autoStopRequested = false
  private lastPreviewStartedAt = Date.now()
  private lastPartialText = ''
  private previewTimer: ReturnType<typeof setTimeout> | undefined
  private silenceTimer: ReturnType<typeof setTimeout> | undefined
  private previewIdle: (() => void) | undefined
  private pcmQueue: Promise<void> = Promise.resolve()

  constructor(
    readonly sessionId: string,
    private readonly language: string,
    private readonly transcribe: Transcribe,
    private readonly extractSpeech: (audio: Float32Array) => Promise<Float32Array>,
    private readonly endpointer: PreviewEndpointer,
    private readonly emit: (event: WorkerEvent) => void,
    private readonly requestStop: () => void = () => {},
  ) {
    // Initial silence also ends the take (user never starts speaking).
    this.armSilenceTimer()
  }

  addPcm(base64: string): void {
    const samples = decodePcm16(base64)
    for (let i = 0; i < samples.length; i++)
      this.buffer.push(samples[i] ?? 0)

    this.pcmQueue = this.pcmQueue
      .then(async () => {
        if (this.previewsClosed)
          return
        const { speaking, speechEnded } = await this.endpointer.push(samples)
        if (speaking) {
          this.clearSilenceTimer()
        }
        else {
          // Arm/restart only when speech just ended, or the timer was cleared while speaking.
          if (speechEnded || this.silenceTimer === undefined)
            this.armSilenceTimer()
        }
        // Only re-run ASR after a real utterance ends — not on every silence chunk.
        if (speechEnded)
          this.previewPending = true
        if (!this.previewsClosed)
          this.trySchedulePreview()
      })
      .catch(() => {})
  }

  stopPreviews(): void {
    this.previewsClosed = true
    this.clearSilenceTimer()
    if (this.previewTimer !== undefined) {
      clearTimeout(this.previewTimer)
      this.previewTimer = undefined
    }
  }

  async waitForPreviewIdle(): Promise<void> {
    await this.pcmQueue.catch(() => {})
    if (!this.previewInFlight)
      return
    await new Promise<void>((resolve) => {
      this.previewIdle = resolve
    })
  }

  async finalize(): Promise<void> {
    this.stopPreviews()
    await this.waitForPreviewIdle()

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

  private trySchedulePreview(): void {
    if (this.previewsClosed || this.previewInFlight || !this.previewPending)
      return

    const wait = Math.max(0, PREVIEW_INTERVAL_MS - (Date.now() - this.lastPreviewStartedAt))
    if (wait > 0) {
      if (this.previewTimer !== undefined)
        return
      this.previewTimer = setTimeout(() => {
        this.previewTimer = undefined
        this.trySchedulePreview()
      }, wait)
      return
    }

    if (this.endpointer.speaking)
      return

    if (this.previewTimer !== undefined) {
      clearTimeout(this.previewTimer)
      this.previewTimer = undefined
    }
    void this.runPreview()
  }

  private async runPreview(): Promise<void> {
    if (this.previewsClosed || this.previewInFlight || this.endpointer.speaking || !this.previewPending)
      return

    this.previewInFlight = true
    this.lastPreviewStartedAt = Date.now()
    try {
      const audio = Float32Array.from(this.buffer.slice(-MAX_PREVIEW_SAMPLES))
      // Keep pending so a later silence chunk can retry once the buffer is long enough.
      if (audio.length < MIN_SPEECH_SAMPLES)
        return

      // Consume the SpeechEnd trigger before ASR so long pauses cannot re-fire.
      this.previewPending = false
      const text = (await this.transcribe(audio, this.language)).trim()
      if (this.previewsClosed || !text || text === this.lastPartialText)
        return

      this.lastPartialText = text
      this.emit({ type: 'partial', sessionId: this.sessionId, text })
    }
    catch {
      // Previews are best-effort; finalization remains authoritative.
    }
    finally {
      this.previewInFlight = false
      this.previewIdle?.()
      this.previewIdle = undefined
    }
  }

  private armSilenceTimer(): void {
    if (this.previewsClosed || this.autoStopRequested)
      return
    this.clearSilenceTimer()
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = undefined
      if (this.previewsClosed || this.autoStopRequested || this.endpointer.speaking)
        return
      this.autoStopRequested = true
      this.requestStop()
    }, SILENCE_AUTO_STOP_MS)
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer === undefined)
      return
    clearTimeout(this.silenceTimer)
    this.silenceTimer = undefined
  }
}

class Worker {
  private child: ChildProcessWithoutNullStreams | undefined
  private lines: Interface | undefined
  private session: TranscriptionSession | undefined
  private transcriber: Transcribe | undefined
  private vad: SileroVad | undefined
  private endpointer: PreviewEndpointer | undefined
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
      const endpointer = await this.ensureEndpointer()
      endpointer.reset()
      await this.ensureHelper()
      this.session = new TranscriptionSession(
        sessionId,
        language,
        transcribe,
        extractSpeech,
        endpointer,
        this.emit,
        () => this.stop(sessionId),
      )
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
    this.session.stopPreviews()
    this.send({ type: 'stop', sessionId })
  }

  private cancel(sessionId: string): void {
    if (!this.session || this.session.sessionId !== sessionId)
      return
    this.session.stopPreviews()
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
    cleanStalePartialDownloads(this.data.cacheDir)
    const asr = await pipeline('automatic-speech-recognition', this.data.modelId, {
      dtype: this.data.dtype as 'q4f16',
      progress_callback: (progress: { status?: string, file?: string, progress?: number, loaded?: number, total?: number }) => {
        if (progress.status === 'progress' && progress.file !== undefined && progress.file !== '') {
          this.emit({
            type: 'modelProgress',
            message: `${progress.file}: ${Math.floor(progress.progress ?? 0)}%`,
            file: progress.file,
            ...(progress.loaded === undefined ? {} : { loaded: progress.loaded }),
            ...(progress.total === undefined ? {} : { total: progress.total }),
          })
        }
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

  private async ensureEndpointer(): Promise<PreviewEndpointer> {
    if (this.endpointer)
      return this.endpointer

    if (process.env.COPILOT_SPEECH_STUB_TRANSCRIPT !== undefined) {
      this.endpointer = openEndpointer()
      return this.endpointer
    }

    this.emit({ type: 'modelProgress', message: 'Loading voice activity model…' })
    this.endpointer = await SileroEndpointer.create(this.data.vadModelPath)
    return this.endpointer
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
    session.stopPreviews()
    if (this.cancelledSessions.delete(sessionId)) {
      await session.waitForPreviewIdle()
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
