import type { Event } from 'vscode'
import type { SpeechEngine, SpeechEvent, StartSessionOptions } from '../src/worker-speech-engine'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'vscode'
import { DictationSession } from '../src/dictation-session'
import { output, resetVSCodeMock } from './support/vscode'

class FakeHelper implements SpeechEngine {
  private readonly emitter = new EventEmitter<SpeechEvent>()
  readonly onEvent: Event<SpeechEvent> = this.emitter.event
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

  fire(event: SpeechEvent): void {
    this.emitter.fire(event)
  }

  dispose(): void {
    this.emitter.dispose()
  }
}

function createDelivery() {
  return {
    commit: vi.fn(async () => {}),
  }
}

const model = { language: 'en' } as const

describe('dictationSession', () => {
  beforeEach(resetVSCodeMock)

  it('delivers the final transcript after stop', async () => {
    const helper = new FakeHelper()
    const delivery = createDelivery()
    const session = new DictationSession(helper, delivery, output)

    await session.start(async () => model)
    expect(session.state.state).toBe('recording')

    session.stop()
    await vi.waitFor(() => expect(delivery.commit).toHaveBeenCalledWith('Hello from speech'))
    await vi.waitFor(() => expect(session.state.state).toBe('idle'))
  })

  it('delivers only the latest recording without prior transcript', async () => {
    const helper = new FakeHelper()
    const delivery = createDelivery()
    const session = new DictationSession(helper, delivery, output)

    await session.start(async () => model)
    session.stop()
    await vi.waitFor(() => expect(session.state.state).toBe('idle'))
    expect(delivery.commit).toHaveBeenLastCalledWith('Hello from speech')

    await session.start(async () => model)
    const sessionId = helper.startOptions!.sessionId
    helper.fire({ type: 'final', sessionId, text: 'and more speech' })

    await vi.waitFor(() => expect(delivery.commit).toHaveBeenLastCalledWith('and more speech'))
    expect(delivery.commit).toHaveBeenCalledTimes(2)
    expect(session.state.state).toBe('idle')
  })

  it('tracks partial transcripts without editing chat', async () => {
    const helper = new FakeHelper()
    const delivery = createDelivery()
    const session = new DictationSession(helper, delivery, output)

    await session.start(async () => model)
    const sessionId = helper.startOptions!.sessionId
    helper.fire({ type: 'partial', sessionId, text: 'Hello' })
    helper.fire({ type: 'partial', sessionId, text: 'Hello from speech' })

    expect(session.state).toEqual({ state: 'recording', partialText: 'Hello from speech' })
    expect(delivery.commit).not.toHaveBeenCalled()
  })

  it('does not edit chat when a session is cancelled', async () => {
    const helper = new FakeHelper()
    const delivery = createDelivery()
    const session = new DictationSession(helper, delivery, output)

    await session.start(async () => model)
    const sessionId = helper.startOptions!.sessionId
    helper.fire({ type: 'partial', sessionId, text: 'Hello' })

    session.cancel()
    await vi.waitFor(() => expect(session.state.state).toBe('idle'))
    expect(session.state.state).toBe('idle')
    expect(delivery.commit).not.toHaveBeenCalled()
  })

  it('ignores an empty final transcript', async () => {
    const helper = new FakeHelper()
    const delivery = createDelivery()
    const session = new DictationSession(helper, delivery, output)

    await session.start(async () => model)
    const sessionId = helper.startOptions!.sessionId
    helper.fire({ type: 'final', sessionId, text: '   ' })

    await vi.waitFor(() => expect(session.state.state).toBe('idle'))
    expect(delivery.commit).not.toHaveBeenCalled()
    expect(session.state.state).toBe('idle')
  })

  it('cancels model preparation without starting the helper', async () => {
    const helper = new FakeHelper()
    const session = new DictationSession(helper, createDelivery(), output)
    const start = session.start(async signal => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(model), { once: true })
    }))

    expect(session.state.state).toBe('preparing')
    session.cancel()
    await start

    expect(session.state.state).toBe('idle')
    expect(helper.startOptions).toBeUndefined()
  })

  it('returns to idle when model preparation is declined', async () => {
    const helper = new FakeHelper()
    const session = new DictationSession(helper, createDelivery(), output)

    await session.start(async () => {
      throw new DOMException('cancelled', 'AbortError')
    })

    expect(session.state.state).toBe('idle')
    expect(helper.startOptions).toBeUndefined()
  })
})
