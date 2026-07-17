import type { Event } from 'vscode'
import type { SpeechHelper, StartSessionOptions } from '../../src/speech/helper-supervisor'
import type { HelperEvent } from '../../src/speech/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'vscode'
import { DictationSession } from '../../src/speech/session'
import { output, resetVSCodeMock } from '../support/vscode'

class FakeHelper implements SpeechHelper {
  private readonly emitter = new EventEmitter<HelperEvent>()
  readonly onEvent: Event<HelperEvent> = this.emitter.event
  startOptions: StartSessionOptions | undefined

  async startSession(options: StartSessionOptions): Promise<void> {
    this.startOptions = options
    this.emitter.fire({ type: 'recording', sessionId: options.sessionId })
  }

  stopSession(sessionId: string): void {
    this.emitter.fire({ type: 'final', sessionId, text: 'Hello from speech' })
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
    const deliver = vi.fn(async () => {})
    const session = new DictationSession(helper, deliver, output)

    await session.start({ modelPath: '/models/medium' })
    expect(session.state.state).toBe('recording')

    session.stop()
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledWith('Hello from speech'))
    await vi.waitFor(() => expect(session.state.state).toBe('idle'))
  })

  it('discards a cancelled session', async () => {
    const helper = new FakeHelper()
    const deliver = vi.fn(async () => {})
    const session = new DictationSession(helper, deliver, output)

    await session.start({ modelPath: '' })
    session.cancel()

    expect(session.state.state).toBe('idle')
    expect(deliver).not.toHaveBeenCalled()
  })
})
