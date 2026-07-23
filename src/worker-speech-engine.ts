import type { Socket } from 'node:net'
import type { Interface } from 'node:readline'
import type { Disposable, Event, LogOutputChannel } from 'vscode'
import type { DaemonCommand, DaemonData, DaemonEvent, InferenceDevice, WorkerEvent } from './worker-protocol'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { EventEmitter } from 'vscode'
import { formatDuration } from './format-duration'
import { DAEMON_PROTOCOL_VERSION, parseDaemonEvent } from './worker-protocol'

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
  daemonPath: string
  helperPath: string
  vadModelPath: string
  modelId: string
  dtype: string
  cacheDir: string
  device: InferenceDevice
  /** Milliseconds after last session before unloading the model. `0` or negative disables. */
  idleUnloadMs: number
}

export class WorkerSpeechEngine implements SpeechEngine {
  private readonly eventEmitter = new EventEmitter<SpeechEvent>()
  private socket: Socket | undefined
  private lines: Interface | undefined
  private connecting: Promise<void> | undefined
  private disposed = false
  private activeSessionId: string | undefined
  private shutdownWaiter: { resolve: () => void, reject: (error: Error) => void } | undefined

  readonly onEvent: Event<SpeechEvent> = this.eventEmitter.event

  constructor(
    private readonly config: WorkerSpeechEngineConfig,
    private readonly output: LogOutputChannel,
  ) {
    void this.ensureConnected().catch(error => this.output.debug(`Shared speech daemon not ready: ${error instanceof Error ? error.message : String(error)}`))
  }

  async startSession(options: StartSessionOptions): Promise<void> {
    const started = performance.now()
    await this.ensureConnected()
    this.activeSessionId = options.sessionId
    const recording = this.waitForSession('recording', options.sessionId, 120_000)
    this.post({ type: 'start', sessionId: options.sessionId, language: options.language })
    try {
      await recording
      this.output.info(`Session ready in ${formatDuration(performance.now() - started)}`)
    }
    catch (error) {
      if (this.activeSessionId === options.sessionId)
        this.activeSessionId = undefined
      throw error
    }
  }

  stopSession(sessionId: string): void {
    this.post({ type: 'stop', sessionId })
  }

  cancelSession(sessionId: string): void {
    this.post({ type: 'cancel', sessionId })
  }

  async prepareModelDeletion(): Promise<void> {
    await this.ensureConnected()
    await new Promise<void>((resolve, reject) => {
      this.shutdownWaiter = { resolve, reject }
      this.post({ type: 'shutdown' })
    })
  }

  dispose(): void {
    this.disposed = true
    this.activeSessionId = undefined
    this.lines?.close()
    this.lines = undefined
    this.socket?.destroy()
    this.socket = undefined
    this.eventEmitter.dispose()
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket)
      return
    if (this.disposed)
      throw new Error('The speech engine has been disposed.')
    if (this.connecting)
      return this.connecting

    this.connecting = this.connectOrStart()
    try {
      await this.connecting
    }
    finally {
      this.connecting = undefined
    }
  }

  private async connectOrStart(): Promise<void> {
    const started = performance.now()
    const daemonData: DaemonData = {
      socketPath: this.socketPath(),
      helperPath: this.config.helperPath,
      vadModelPath: this.config.vadModelPath,
      modelId: this.config.modelId,
      dtype: this.config.dtype,
      cacheDir: this.config.cacheDir,
      device: this.config.device,
      idleUnloadMs: this.config.idleUnloadMs,
    }
    try {
      await this.connect(daemonData.socketPath)
    }
    catch {
      this.output.info('Starting shared speech daemon.')
      const child = spawn(process.execPath, [this.config.daemonPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          COPILOT_SPEECH_DAEMON_DATA: JSON.stringify(daemonData),
        },
      })
      child.unref()
      const deadline = Date.now() + 5000
      while (true) {
        try {
          await this.connect(daemonData.socketPath)
          break
        }
        catch (error) {
          if (Date.now() >= deadline)
            throw error
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }
    }
    this.output.info(`Shared speech daemon ready in ${formatDuration(performance.now() - started)}`)
  }

  private async connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath)
      socket.once('error', error => reject(error))
      socket.once('connect', () => {
        const lines = createInterface({ input: socket })
        lines.on('line', (line) => {
          let event: DaemonEvent
          try {
            event = parseDaemonEvent(line)
          }
          catch {
            return
          }
          if (event.type === 'hello') {
            if (event.protocolVersion !== DAEMON_PROTOCOL_VERSION) {
              lines.close()
              socket.destroy()
              reject(new Error(`Speech daemon protocol mismatch: ${event.protocolVersion}`))
              return
            }
            socket.removeAllListeners('error')
            socket.on('error', error => this.handleSocketFailure(error.message))
            socket.on('close', () => this.handleSocketFailure('Shared speech daemon stopped.'))
            this.socket = socket
            this.lines = lines
            resolve()
            return
          }
          if (event.type === 'shutdownResult') {
            const waiter = this.shutdownWaiter
            this.shutdownWaiter = undefined
            if (event.ok)
              waiter?.resolve()
            else
              waiter?.reject(new Error(event.message ?? 'Could not stop the shared speech runtime.'))
            return
          }
          this.handleWorkerEvent(event)
        })
        socket.write(`${JSON.stringify({ type: 'hello', protocolVersion: DAEMON_PROTOCOL_VERSION })}\n`)
      })
      socket.once('close', () => {
        if (!this.socket)
          reject(new Error('Shared speech daemon closed during handshake.'))
      })
    })
  }

  private handleWorkerEvent(event: WorkerEvent): void {
    if (event.type === 'modelProgress') {
      if (event.level === 'info')
        this.output.info(event.message)
      else if (event.level === 'warning')
        this.output.warn(event.message)
      else
        this.output.debug(`model: ${event.message}`)
    }
    else if (event.type === 'partial') {
      this.output.debug(`engine event: partial (${event.text.length} chars)`)
    }
    else {
      this.output.debug(`engine event: ${event.type}`)
    }

    if (event.type === 'final' || event.type === 'cancelled') {
      if (event.sessionId === this.activeSessionId)
        this.activeSessionId = undefined
    }
    else if (event.type === 'error') {
      if (event.sessionId === undefined || event.sessionId === this.activeSessionId)
        this.activeSessionId = undefined
    }

    this.eventEmitter.fire(event)
  }

  private handleSocketFailure(message: string): void {
    if (!this.socket)
      return
    this.lines?.close()
    this.lines = undefined
    this.socket = undefined
    this.shutdownWaiter?.reject(new Error(message))
    this.shutdownWaiter = undefined
    if (this.activeSessionId !== undefined) {
      const sessionId = this.activeSessionId
      this.activeSessionId = undefined
      this.eventEmitter.fire({ type: 'error', code: 'daemon_failure', message, sessionId })
    }
  }

  private post(command: DaemonCommand): void {
    if (!this.socket)
      throw new Error('The shared speech daemon is not running.')
    this.socket.write(`${JSON.stringify(command)}\n`)
  }

  private socketPath(): string {
    const id = createHash('sha256').update(`${DAEMON_PROTOCOL_VERSION}:${this.config.cacheDir}:${this.config.device}`).digest('hex').slice(0, 16)
    return process.platform === 'win32'
      ? `\\\\.\\pipe\\copilot-speech-${id}`
      : join(tmpdir(), `copilot-speech-${id}.sock`)
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
