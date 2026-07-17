import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Interface } from 'node:readline'
import type { Disposable, Event, LogOutputChannel } from 'vscode'
import type { HelperCommand, HelperEvent } from './protocol'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { EventEmitter } from 'vscode'
import { parseHelperEvent, PROTOCOL_VERSION } from './protocol'

export interface StartSessionOptions {
  sessionId: string
  modelPath: string
}

export interface SpeechHelper extends Disposable {
  readonly onEvent: Event<HelperEvent>
  startSession: (options: StartSessionOptions) => Promise<void>
  stopSession: (sessionId: string) => void
  cancelSession: (sessionId: string) => void
}

export class HelperUnavailableError extends Error {}

export class HelperSupervisor implements SpeechHelper {
  private readonly eventEmitter = new EventEmitter<HelperEvent>()
  private child: ChildProcessWithoutNullStreams | undefined
  private lines: Interface | undefined
  private disposed = false

  readonly onEvent = this.eventEmitter.event

  constructor(
    private readonly resolveHelperPath: () => string,
    private readonly output: LogOutputChannel,
  ) {}

  async startSession(options: StartSessionOptions): Promise<void> {
    await this.ensureRunning()
    const recording = this.waitFor('recording')
    this.send({ type: 'start', ...options })
    const event = await recording
    if (event.sessionId !== options.sessionId)
      throw new Error('Helper acknowledged a different dictation session.')
  }

  stopSession(sessionId: string): void {
    this.send({ type: 'stop', sessionId })
  }

  cancelSession(sessionId: string): void {
    this.send({ type: 'cancel', sessionId })
  }

  dispose(): void {
    this.disposed = true
    if (this.child && !this.child.killed)
      this.child.kill()
    this.lines?.close()
    this.lines = undefined
    this.child = undefined
    this.eventEmitter.dispose()
  }

  private async ensureRunning(): Promise<void> {
    if (this.child && !this.child.killed)
      return

    const helperPath = this.resolveHelperPath().trim()
    if (!helperPath)
      throw new HelperUnavailableError('No native helper is configured yet. Set Copilot Speech: Helper Path to a local development build.')

    this.output.info(`Starting native helper: ${helperPath}`)
    const child = spawn(helperPath, ['--stdio'], {
      stdio: 'pipe',
      windowsHide: true,
    })
    this.child = child
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', line => this.handleLine(line))
    child.stderr.resume()
    child.on('error', error => this.handleProcessFailure(`Native helper failed: ${error.message}`))
    child.on('exit', (code, signal) => {
      this.child = undefined
      this.lines?.close()
      this.lines = undefined
      if (!this.disposed && code !== 0)
        this.handleProcessFailure(`Native helper exited with code ${code ?? 'none'} and signal ${signal ?? 'none'}.`)
    })

    const hello = this.waitFor('hello')
    this.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION })
    const response = await hello
    if (response.protocolVersion !== PROTOCOL_VERSION)
      throw new Error(`Native helper protocol ${response.protocolVersion} is incompatible with extension protocol ${PROTOCOL_VERSION}.`)
    this.output.info(`Native helper ${response.helperVersion} connected.`)
  }

  private handleLine(line: string): void {
    if (Buffer.byteLength(line, 'utf8') > 1024 * 1024) {
      this.handleProcessFailure('Native helper emitted an oversized protocol message.')
      return
    }

    try {
      const event = parseHelperEvent(line)
      this.output.debug(`helper event: ${event.type}`)
      this.eventEmitter.fire(event)
    }
    catch (error) {
      this.handleProcessFailure(error instanceof Error ? error.message : String(error))
    }
  }

  private handleProcessFailure(message: string): void {
    this.output.error(message)
    this.eventEmitter.fire({ type: 'error', code: 'helper_failure', message })
  }

  private send(command: HelperCommand): void {
    if (!this.child || this.child.killed || !this.child.stdin.writable)
      throw new HelperUnavailableError('Native helper is not running.')
    this.child.stdin.write(`${JSON.stringify(command)}\n`)
  }

  private async waitFor<T extends HelperEvent['type']>(type: T, timeoutMs = 5000): Promise<Extract<HelperEvent, { type: T }>> {
    return new Promise((resolve, reject) => {
      let subscription: Disposable | undefined
      const timeout = setTimeout(() => {
        subscription?.dispose()
        reject(new Error(`Timed out waiting for native helper event: ${type}`))
      }, timeoutMs)
      subscription = this.onEvent((event) => {
        if (event.type === 'error') {
          clearTimeout(timeout)
          subscription?.dispose()
          reject(new Error(`${event.code}: ${event.message}`))
          return
        }
        if (event.type !== type)
          return
        clearTimeout(timeout)
        subscription?.dispose()
        resolve(event as Extract<HelperEvent, { type: T }>)
      })
    })
  }
}
