import type { WorkerData, WorkerEvent } from '../src/transcription-worker'
import { describe, expect, it, vi } from 'vitest'
import { TranscriptionWorker } from '../src/transcription-worker'

const data: WorkerData = {
  helperPath: '/dev/null',
  vadModelPath: '/dev/null',
  modelId: 'test-model',
  dtype: 'q4f16',
  cacheDir: '/tmp/models',
  device: 'auto',
}

interface WorkerInternals {
  ensureTranscriber: () => Promise<(audio: Float32Array, language: string) => Promise<string>>
}

interface PipelineOptions {
  device: 'webgpu' | 'cpu'
  dtype: 'q4f16'
}

function pipelineResult(text = 'transcript') {
  return Object.assign(
    vi.fn(async () => ({ text })),
    { dispose: vi.fn(async () => {}) },
  )
}

function setup(device: 'auto' | 'gpu' | 'cpu' = 'auto', failWebgpu = false) {
  const events: WorkerEvent[] = []
  const asr = pipelineResult()
  const calls: PipelineOptions[] = []
  const pipeline = async (_task: string, _modelId: string, options: PipelineOptions): Promise<typeof asr> => {
    calls.push(options)
    if (failWebgpu && options.device === 'webgpu')
      throw new Error('No compatible GPU adapter')
    return asr
  }
  const worker = new TranscriptionWorker({ ...data, device }, event => events.push(event), async () => ({
    pipeline,
    env: { cacheDir: '' },
  }))
  return { worker, events, calls }
}

describe('transcriptionWorker inference device', () => {
  it('loads the speech model on WebGPU first', async () => {
    const { worker, events, calls } = setup()

    await (worker as unknown as WorkerInternals).ensureTranscriber()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ device: 'webgpu', dtype: 'q4f16' })
    expect(events.some(event => event.type === 'modelProgress' && event.message.includes('Speech model loaded on WebGPU') && event.level === 'info')).toBe(true)
  })

  it('logs the WebGPU error and retries on CPU', async () => {
    const { worker, events, calls } = setup('auto', true)

    await (worker as unknown as WorkerInternals).ensureTranscriber()

    expect(calls.map(call => call.device)).toEqual(['webgpu', 'cpu'])
    expect(events).toContainEqual({
      type: 'modelProgress',
      message: 'WebGPU unavailable; falling back to CPU: No compatible GPU adapter',
      level: 'warning',
    })
    expect(events.some(event => event.type === 'modelProgress' && event.message.includes('Speech model loaded on CPU') && event.level === 'info')).toBe(true)
  })

  it('uses only CPU when CPU is forced', async () => {
    const { worker, events, calls } = setup('cpu')

    await (worker as unknown as WorkerInternals).ensureTranscriber()

    expect(calls.map(call => call.device)).toEqual(['cpu'])
    expect(events).toContainEqual({
      type: 'modelProgress',
      message: 'Using CPU for speech recognition (forced).',
      level: 'info',
    })
  })

  it('does not label a forced CPU failure as a WebGPU failure', async () => {
    const events: WorkerEvent[] = []
    const calls: PipelineOptions[] = []
    const pipeline = async (_task: string, _modelId: string, options: PipelineOptions): Promise<ReturnType<typeof pipelineResult>> => {
      calls.push(options)
      throw new Error('CPU session failed')
    }
    const worker = new TranscriptionWorker({ ...data, device: 'cpu' }, event => events.push(event), async () => ({
      pipeline,
      env: { cacheDir: '' },
    }))

    await expect((worker as unknown as WorkerInternals).ensureTranscriber()).rejects.toThrow('CPU session failed')

    expect(calls.map(call => call.device)).toEqual(['cpu'])
    expect(events.some(event => event.type === 'modelProgress' && event.level === 'warning')).toBe(false)
  })

  it('does not fall back to CPU when GPU is forced', async () => {
    const { worker, events, calls } = setup('gpu', true)

    await expect((worker as unknown as WorkerInternals).ensureTranscriber()).rejects.toThrow('No compatible GPU adapter')

    expect(calls.map(call => call.device)).toEqual(['webgpu'])
    expect(events).toContainEqual({
      type: 'modelProgress',
      message: 'WebGPU initialization failed: No compatible GPU adapter',
      level: 'warning',
    })
  })
})
