import type { Mock } from 'vitest'
import type { WorkerCommand, WorkerEvent } from '../src/transcription-worker'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkerSpeechEngine } from '../src/worker-speech-engine'
import { output } from './support/vscode'

type MessageHandler = (event: WorkerEvent) => void

const { FakeNodeWorker } = vi.hoisted(() => {
  class FakeNodeWorker {
    static instances: FakeNodeWorker[] = []
    readonly posted: WorkerCommand[] = []
    private messageHandler: MessageHandler | undefined
    private exitHandler: ((code: number) => void) | undefined

    constructor(_path: string, _options: unknown) {
      FakeNodeWorker.instances.push(this)
    }

    on(event: string, handler: (...args: never[]) => void): this {
      if (event === 'message')
        this.messageHandler = handler as MessageHandler
      if (event === 'exit')
        this.exitHandler = handler as (code: number) => void
      return this
    }

    postMessage(command: WorkerCommand): void {
      this.posted.push(command)
      if (command.type === 'start') {
        queueMicrotask(() => {
          this.messageHandler?.({ type: 'recording', sessionId: command.sessionId })
        })
      }
    }

    async terminate(): Promise<number> {
      this.exitHandler?.(0)
      return 0
    }

    emit(event: WorkerEvent): void {
      this.messageHandler?.(event)
    }
  }

  return { FakeNodeWorker }
})

vi.mock('node:worker_threads', () => ({
  Worker: FakeNodeWorker,
}))

describe('workerSpeechEngine idle unload', () => {
  beforeEach(() => {
    FakeNodeWorker.instances = []
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createEngine(idleUnloadMs: number): WorkerSpeechEngine {
    return new WorkerSpeechEngine(
      {
        workerPath: '/tmp/worker.js',
        helperPath: '/tmp/helper',
        vadModelPath: '/tmp/vad.onnx',
        modelId: 'test-model',
        dtype: 'q4f16',
        cacheDir: '/tmp/cache',
        idleUnloadMs,
      },
      output,
    )
  }

  it('posts unloadModel after the idle timeout once a session finishes', async () => {
    const engine = createEngine(1_000)
    await engine.startSession({ sessionId: 's1', language: 'en' })
    const worker = FakeNodeWorker.instances[0]!
    expect(worker.posted.some(c => c.type === 'start')).toBe(true)

    worker.emit({ type: 'final', sessionId: 's1', text: 'hello' })
    expect(worker.posted.some(c => c.type === 'unloadModel')).toBe(false)

    await vi.advanceTimersByTimeAsync(999)
    expect(worker.posted.some(c => c.type === 'unloadModel')).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(worker.posted.filter(c => c.type === 'unloadModel')).toHaveLength(1)
    const infoMessages = (output.info as Mock).mock.calls.map(call => String(call[0]))
    expect(infoMessages.some(message => message.includes('Idle timeout reached'))).toBe(true)
    engine.dispose()
  })

  it('cancels a pending unload when a new session starts', async () => {
    const engine = createEngine(1_000)
    await engine.startSession({ sessionId: 's1', language: 'en' })
    const worker = FakeNodeWorker.instances[0]!
    worker.emit({ type: 'final', sessionId: 's1', text: 'hello' })

    await vi.advanceTimersByTimeAsync(500)
    await engine.startSession({ sessionId: 's2', language: 'en' })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(worker.posted.filter(c => c.type === 'unloadModel')).toHaveLength(0)

    worker.emit({ type: 'final', sessionId: 's2', text: 'again' })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(worker.posted.filter(c => c.type === 'unloadModel')).toHaveLength(1)
    engine.dispose()
  })

  it('never schedules unload when idleUnloadMs is 0', async () => {
    const engine = createEngine(0)
    await engine.startSession({ sessionId: 's1', language: 'en' })
    const worker = FakeNodeWorker.instances[0]!
    worker.emit({ type: 'final', sessionId: 's1', text: 'hello' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(worker.posted.some(c => c.type === 'unloadModel')).toBe(false)
    engine.dispose()
  })

  it('logs session ready duration after recording starts', async () => {
    const engine = createEngine(0)
    await engine.startSession({ sessionId: 's1', language: 'en' })
    const infoMessages = (output.info as Mock).mock.calls.map(call => String(call[0]))
    expect(infoMessages.some(message => message.startsWith('Session ready in '))).toBe(true)
    expect(infoMessages.some(message => message.startsWith('Worker started in '))).toBe(true)
    engine.dispose()
  })
})
