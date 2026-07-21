import type { Disposable, Event, LogOutputChannel } from 'vscode'
import type { WorkerCommand, WorkerData, WorkerEvent } from './transcription-worker'
import { Worker } from 'node:worker_threads'
import { EventEmitter } from 'vscode'

export interface StartSessionOptions {
  sessionId: string
  language: string
}

export type SpeechEvent = WorkerEvent

export interface SpeechEngine extends Disposable {
  readonly onEvent: Event<SpeechEvent>
  startSession: (options: StartSessionOptions) => Promise<void>
  stopSession: (sessionId: string) => void
  cancelSession: (sessionId: string) => void
}

export interface WorkerSpeechEngineConfig {
  workerPath: string
  helperPath: string
  vadModelPath: string
  modelId: string
  dtype: string
  cacheDir: string
}

export class WorkerSpeechEngine implements SpeechEngine {
  private readonly eventEmitter = new EventEmitter<SpeechEvent>()
  private worker: Worker | undefined
  private disposed = false

  readonly onEvent: Event<SpeechEvent> = this.eventEmitter.event

  constructor(
    private readonly config: WorkerSpeechEngineConfig,
    private readonly output: LogOutputChannel,
  ) {}

  async startSession(options: StartSessionOptions): Promise<void> {
    this.ensureWorker()
    const recording = this.waitForSession('recording', options.sessionId, 120_000)
    this.post({ type: 'start', sessionId: options.sessionId, language: options.language })
    await recording
  }

  stopSession(sessionId: string): void {
    this.post({ type: 'stop', sessionId })
  }

  cancelSession(sessionId: string): void {
    this.post({ type: 'cancel', sessionId })
  }

  dispose(): void {
    this.disposed = true
    void this.worker?.terminate()
    this.worker = undefined
    this.eventEmitter.dispose()
  }

  private ensureWorker(): void {
    if (this.worker)
      return
    if (this.disposed)
      throw new Error('The speech engine has been disposed.')

    this.output.info('Starting transcription worker.')
    const workerData: WorkerData = {
      helperPath: this.config.helperPath,
      vadModelPath: this.config.vadModelPath,
      modelId: this.config.modelId,
      dtype: this.config.dtype,
      cacheDir: this.config.cacheDir,
    }
    const worker = new Worker(this.config.workerPath, { workerData })
    this.worker = worker
    worker.on('message', (event: WorkerEvent) => this.handleWorkerEvent(event))
    worker.on('error', (error: Error) => {
      this.output.error(`Transcription worker error: ${error.message}`)
      this.eventEmitter.fire({ type: 'error', code: 'worker_failure', message: error.message })
    })
    worker.on('exit', (code) => {
      this.worker = undefined
      if (!this.disposed && code !== 0)
        this.eventEmitter.fire({ type: 'error', code: 'worker_exit', message: `Transcription worker exited with code ${code}.` })
    })
  }

  private handleWorkerEvent(event: WorkerEvent): void {
    if (event.type === 'modelProgress')
      this.output.debug(`model: ${event.message}`)
    else if (event.type === 'partial')
      this.output.debug(`engine event: partial (${event.text.length} chars)`)
    else
      this.output.debug(`engine event: ${event.type}`)
    this.eventEmitter.fire(event)
  }

  private post(command: WorkerCommand): void {
    if (!this.worker)
      throw new Error('The transcription worker is not running.')
    this.worker.postMessage(command)
  }

  private async waitForSession<T extends Extract<SpeechEvent, { sessionId: string }>['type']>(
    type: T,
    sessionId: string,
    timeoutMs: number,
  ): Promise<Extract<SpeechEvent, { type: T }>> {
    return new Promise((resolve, reject) => {
      let subscription: Disposable | undefined
      const timeout = setTimeout(() => {
        subscription?.dispose()
        reject(new Error(`Timed out waiting for engine event: ${type}`))
      }, timeoutMs)
      subscription = this.onEvent((event) => {
        if (event.type === 'error' && (!('sessionId' in event) || event.sessionId === undefined || event.sessionId === sessionId)) {
          clearTimeout(timeout)
          subscription?.dispose()
          reject(new Error(`${event.code}: ${event.message}`))
          return
        }
        if (event.type !== type || !('sessionId' in event) || event.sessionId !== sessionId)
          return
        clearTimeout(timeout)
        subscription?.dispose()
        resolve(event as Extract<SpeechEvent, { type: T }>)
      })
    })
  }
}
