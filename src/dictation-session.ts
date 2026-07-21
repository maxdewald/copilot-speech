import type { Disposable, Event, LogOutputChannel } from 'vscode'
import type { ChatDelivery } from './chat-delivery'
import type { SpeechEngine, SpeechEvent } from './worker-speech-engine'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'vscode'

export type DictationState = 'idle' | 'preparing' | 'starting' | 'recording' | 'stopping' | 'cancelling' | 'delivering' | 'error'

export interface DictationSnapshot {
  state: DictationState
  partialText: string
  error?: string
}

export interface DictationOptions {
  language: string
}

type Delivery = Pick<ChatDelivery, 'showPreview' | 'commit' | 'clearPreview'>

export class DictationSession implements Disposable {
  private readonly stateEmitter = new EventEmitter<DictationSnapshot>()
  private readonly helperSubscription: Disposable
  private preparation: AbortController | undefined
  private currentSessionId: string | undefined
  private deliveryChain: Promise<void> = Promise.resolve()
  private snapshot: DictationSnapshot = { state: 'idle', partialText: '' }

  readonly onDidChangeState: Event<DictationSnapshot> = this.stateEmitter.event

  constructor(
    private readonly helper: SpeechEngine,
    private readonly delivery: Delivery,
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

  private async handleHelperEvent(event: SpeechEvent): Promise<void> {
    if ('sessionId' in event && event.sessionId !== undefined && event.sessionId !== this.currentSessionId)
      return

    switch (event.type) {
      case 'modelProgress':
        this.output.debug(`model progress: ${event.message}`)
        break
      case 'recording':
        this.update({ state: 'recording', partialText: '' })
        break
      case 'partial': {
        if (this.snapshot.state !== 'recording')
          break
        const text = event.text.trim()
        this.update({ state: 'recording', partialText: text })
        if (text) {
          this.output.debug('dictation preview ready')
          void this.enqueueDelivery(async () => this.delivery.showPreview(text))
        }
        break
      }
      case 'final':
        await this.deliver(event.text)
        break
      case 'cancelled':
        await this.enqueueDelivery(async () => this.delivery.clearPreview())
        this.currentSessionId = undefined
        this.update({ state: 'idle', partialText: '' })
        break
      case 'error':
        void this.enqueueDelivery(async () => this.delivery.clearPreview())
        this.currentSessionId = undefined
        this.update({ state: 'error', partialText: '', error: event.message })
        break
    }
  }

  private async deliver(text: string): Promise<void> {
    const transcript = text.trim()
    this.update({ state: 'delivering', partialText: transcript })
    try {
      await this.enqueueDelivery(async () => {
        if (transcript)
          await this.delivery.commit(transcript)
        else
          await this.delivery.clearPreview()
      })
      this.currentSessionId = undefined
      this.update({ state: 'idle', partialText: '' })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.error(`Transcript delivery failed: ${message}`)
      this.update({ state: 'error', partialText: transcript, error: message })
    }
  }

  private async enqueueDelivery(operation: () => Promise<void>): Promise<void> {
    const run = this.deliveryChain.then(operation, operation)
    this.deliveryChain = run.then(() => undefined, () => undefined)
    return run
  }

  private update(snapshot: DictationSnapshot): void {
    this.snapshot = snapshot
    this.output.debug(`dictation state: ${snapshot.state}`)
    this.stateEmitter.fire(snapshot)
  }
}
