import type { Event } from 'vscode'
import type { TranscriptDelivery } from '../../src/delivery/chat'
import type { SpeechHelper, StartSessionOptions } from '../../src/speech/helper-supervisor'
import type { HelperEvent, SpeechDevice } from '../../src/speech/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'vscode'
import { DictationSession } from '../../src/speech/session'
import { output, resetVSCodeMock } from '../support/vscode'

class FakeHelper implements SpeechHelper {
  private readonly emitter = new EventEmitter<HelperEvent>()
  readonly onEvent: Event<HelperEvent> = this.emitter.event
  readonly configuredPath = '/tmp/helper'
  startOptions: StartSessionOptions | undefined

  async listDevices(): Promise<SpeechDevice[]> {
    return []
  }

  async startSession(options: StartSessionOptions): Promise<void> {
    this.startOptions = options
  }

  stopSession(sessionId: string): void {
    this.emitter.fire({ type: 'final', sessionId, sequence: 1, text: 'Hello from speech' })
  }

  cancelSession(sessionId: string): void {
    this.emitter.fire({ type: 'cancelled', sessionId })
  }

  fire(event: HelperEvent): void {
    this.emitter.fire(event)
  }

  dispose(): void {
    this.emitter.dispose()
  }
}

describe('dictationSession', () => {
  beforeEach(resetVSCodeMock)

  it('delivers the final transcript after stop', async () => {
    const helper = new FakeHelper()
    const delivery: TranscriptDelivery = { deliver: vi.fn(async () => {}) }
    const session = new DictationSession(helper, delivery, output)

    await session.start({ model: 'medium-streaming-en', modelPath: '/models/medium', deviceId: 'default' })
    expect(session.state.state).toBe('recording')

    session.stop()
    await vi.waitFor(() => expect(delivery.deliver).toHaveBeenCalledWith('Hello from speech'))
    expect(session.state.state).toBe('idle')
  })

  it('discards a cancelled session', async () => {
    const helper = new FakeHelper()
    const delivery: TranscriptDelivery = { deliver: vi.fn(async () => {}) }
    const session = new DictationSession(helper, delivery, output)

    await session.start({ model: 'small-streaming-en', modelPath: '', deviceId: 'default' })
    session.cancel()

    expect(session.state.state).toBe('idle')
    expect(delivery.deliver).not.toHaveBeenCalled()
  })
})
