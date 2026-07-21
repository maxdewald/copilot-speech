import type { WorkerData, WorkerEvent } from '../src/transcription-worker'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TranscriptionWorker } from '../src/transcription-worker'

const data: WorkerData = {
  helperPath: '/dev/null',
  vadModelPath: '/dev/null',
  modelId: 'test-model',
  dtype: 'q4f16',
  cacheDir: '/tmp',
}

interface WorkerInternals {
  ensureTranscriber: () => Promise<(audio: Float32Array, language: string) => Promise<string>>
  session: { sessionId: string } | undefined
}

describe('transcriptionWorker unloadModel', () => {
  const previousStub = process.env.COPILOT_SPEECH_STUB_TRANSCRIPT

  beforeEach(() => {
    process.env.COPILOT_SPEECH_STUB_TRANSCRIPT = 'stub transcript'
  })

  afterEach(() => {
    if (previousStub === undefined)
      delete process.env.COPILOT_SPEECH_STUB_TRANSCRIPT
    else
      process.env.COPILOT_SPEECH_STUB_TRANSCRIPT = previousStub
  })

  it('clears a loaded stub model and reloads on next ensure', async () => {
    const events: WorkerEvent[] = []
    const worker = new TranscriptionWorker(data, event => events.push(event))
    const internal = worker as unknown as WorkerInternals

    await internal.ensureTranscriber()
    expect(worker.hasModelLoaded()).toBe(true)
    expect(events.some(e => e.type === 'modelProgress' && e.message.includes('Speech model loaded'))).toBe(true)

    await worker.handle({ type: 'unloadModel' })
    expect(worker.hasModelLoaded()).toBe(false)
    expect(events.some(e => e.type === 'modelProgress' && e.message.includes('Speech model released'))).toBe(true)

    await internal.ensureTranscriber()
    expect(worker.hasModelLoaded()).toBe(true)
    expect(events.some(e => e.type === 'modelProgress' && e.message.includes('Speech model loaded'))).toBe(true)
  })

  it('does not unload while a session is active', async () => {
    const events: WorkerEvent[] = []
    const worker = new TranscriptionWorker(data, event => events.push(event))
    const internal = worker as unknown as WorkerInternals

    await internal.ensureTranscriber()
    internal.session = { sessionId: 'active' }

    await worker.handle({ type: 'unloadModel' })
    expect(worker.hasModelLoaded()).toBe(true)
    expect(events.some(e => e.type === 'modelProgress' && e.message.includes('Skipped model unload'))).toBe(true)
  })

  it('is a no-op when already unloaded', async () => {
    const events: WorkerEvent[] = []
    const worker = new TranscriptionWorker(data, event => events.push(event))

    await worker.handle({ type: 'unloadModel' })
    expect(worker.hasModelLoaded()).toBe(false)
    expect(events.some(e => e.type === 'modelProgress' && e.message.includes('already unloaded'))).toBe(true)
  })
})
