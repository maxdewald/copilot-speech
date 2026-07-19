import type { Disposable, Event, LogOutputChannel } from 'vscode'
import type { SpeechHelper } from './helper-process'
import type { HelperEvent } from './helper-protocol'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'vscode'

export type DictationState = 'idle' | 'preparing' | 'starting' | 'recording' | 'stopping' | 'cancelling' | 'delivering' | 'error'

export interface DictationSnapshot {
  state: DictationState
  partialText: string
  error?: string
}

export interface DictationOptions {
  modelPath: string
}

export class DictationSession implements Disposable {
  private readonly stateEmitter = new EventEmitter<DictationSnapshot>()
  private readonly helperSubscription: Disposable
  private preparation: AbortController | undefined
  private currentSessionId: string | undefined
  private snapshot: DictationSnapshot = { state: 'idle', partialText: '' }
  private lastDeliveredPartial = ''
  private partialDelivery = Promise.resolve()

  readonly onDidChangeState: Event<DictationSnapshot> = this.stateEmitter.event

  constructor(
    private readonly helper: SpeechHelper,
    private readonly deliverTranscript: (transcript: string) => Promise<void>,
    private readonly output: LogOutputChannel,
  ) {
    this.helperSubscription = helper.onEvent(event => void this.handleHelperEvent(event))
  }

  get state(): DictationSnapshot {
    return this.snapshot
  }

  async start(prepare: (signal: AbortSignal) => Promise<DictationOptions>): Promise<void> {
    if (this.snapshot.state !== 'idle' && this.snapshot.state !== 'error')
      return

    const preparation = new AbortController()
    this.preparation = preparation
    this.update({ state: 'preparing', partialText: '' })
    try {
      const options = await prepare(preparation.signal)
      if (preparation.signal.aborted) {
        this.update({ state: 'idle', partialText: '' })
        return
      }
      const sessionId = randomUUID()
      this.currentSessionId = sessionId
      this.update({ state: 'starting', partialText: '' })
      await this.helper.startSession({ sessionId, ...options })
    }
    catch (error) {
      if (preparation.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        this.update({ state: 'idle', partialText: '' })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.currentSessionId = undefined
      this.update({ state: 'error', partialText: '', error: message })
      throw error
    }
    finally {
      if (this.preparation === preparation)
        this.preparation = undefined
    }
  }

  stop(): void {
    if (this.snapshot.state !== 'recording' || this.currentSessionId === undefined)
      return
    this.update({ ...this.snapshot, state: 'stopping' })
    this.helper.stopSession(this.currentSessionId)
  }

  cancel(): void {
    if (this.snapshot.state === 'preparing') {
      this.update({ ...this.snapshot, state: 'cancelling' })
      this.preparation?.abort()
      return
    }
    if (this.currentSessionId === undefined || !['starting', 'recording', 'stopping'].includes(this.snapshot.state))
      return
    this.update({ ...this.snapshot, state: 'cancelling' })
    this.helper.cancelSession(this.currentSessionId)
  }

  dispose(): void {
    this.helperSubscription.dispose()
    this.stateEmitter.dispose()
  }

  private async handleHelperEvent(event: HelperEvent): Promise<void> {
    if ('sessionId' in event && event.sessionId !== undefined && event.sessionId !== this.currentSessionId)
      return

    switch (event.type) {
      case 'hello':
        break
      case 'recording':
        this.lastDeliveredPartial = ''
        this.update({ state: 'recording', partialText: '' })
        break
      case 'partial': {
        const transcript = event.text.trim()
        this.update({ state: 'recording', partialText: transcript })
        if (transcript && transcript !== this.lastDeliveredPartial) {
          this.lastDeliveredPartial = transcript
          this.partialDelivery = this.partialDelivery
            .then(async () => this.deliverTranscript(transcript))
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error)
              this.output.error(`Partial transcript delivery failed: ${message}`)
            })
        }
        break
      }
      case 'final':
        await this.partialDelivery
        await this.deliver(event.text)
        break
      case 'cancelled':
        this.currentSessionId = undefined
        this.update({ state: 'idle', partialText: '' })
        break
      case 'error':
        this.currentSessionId = undefined
        this.update({ state: 'error', partialText: '', error: event.message })
        break
    }
  }

  private async deliver(text: string): Promise<void> {
    const transcript = text.trim()
    this.update({ state: 'delivering', partialText: transcript })
    try {
      if (transcript)
        await this.deliverTranscript(transcript)
      this.currentSessionId = undefined
      this.update({ state: 'idle', partialText: '' })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.error(`Transcript delivery failed: ${message}`)
      this.update({ state: 'error', partialText: transcript, error: message })
    }
  }

  private update(snapshot: DictationSnapshot): void {
    this.snapshot = snapshot
    this.output.debug(`dictation state: ${snapshot.state}`)
    this.stateEmitter.fire(snapshot)
  }
}
