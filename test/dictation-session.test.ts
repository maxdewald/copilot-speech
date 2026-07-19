import type { Event } from 'vscode'
import type { SpeechHelper, StartSessionOptions } from '../src/helper-process'
import type { HelperEvent } from '../src/helper-protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'vscode'
import { DictationSession } from '../src/dictation-session'
import { output, resetVSCodeMock } from './support/vscode'

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

    await session.start(async () => ({ modelPath: '/models/medium' }))
    expect(session.state.state).toBe('recording')

    session.stop()
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledWith('Hello from speech'))
    await vi.waitFor(() => expect(session.state.state).toBe('idle'))
  })

  it('discards a cancelled session', async () => {
    const helper = new FakeHelper()
    const deliver = vi.fn(async () => {})
    const session = new DictationSession(helper, deliver, output)

    await session.start(async () => ({ modelPath: '' }))
    session.cancel()

    expect(session.state.state).toBe('idle')
    expect(deliver).not.toHaveBeenCalled()
  })

  it('cancels model preparation without starting the helper', async () => {
    const helper = new FakeHelper()
    const session = new DictationSession(helper, vi.fn(async () => {}), output)
    const start = session.start(async signal => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ modelPath: '' }), { once: true })
    }))

    expect(session.state.state).toBe('preparing')
    session.cancel()
    await start

    expect(session.state.state).toBe('idle')
    expect(helper.startOptions).toBeUndefined()
  })

  it('returns to idle when model preparation is declined', async () => {
    const helper = new FakeHelper()
    const session = new DictationSession(helper, vi.fn(async () => {}), output)

    await session.start(async () => {
      throw new DOMException('cancelled', 'AbortError')
    })

    expect(session.state.state).toBe('idle')
    expect(helper.startOptions).toBeUndefined()
  })
})
