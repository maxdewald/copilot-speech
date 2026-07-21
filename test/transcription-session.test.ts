import type { PreviewEndpointer, WorkerEvent } from '../src/transcription-worker'
import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openEndpointer } from '../src/silero-vad'
import { SILENCE_AUTO_STOP_MS, TranscriptionSession } from '../src/transcription-worker'

const SAMPLE_RATE = 16000

function encodePcm16(samples: number[]): string {
  const bytes = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    bytes.writeInt16LE(Math.round(clamped * 32767), i * 2)
  }
  return bytes.toString('base64')
}

function speechChunk(seconds: number, amplitude = 0.2): string {
  const n = Math.floor(seconds * SAMPLE_RATE)
  return encodePcm16(Array.from({ length: n }).fill(amplitude) as number[])
}

class FakeEndpointer implements PreviewEndpointer {
  speaking = false
  private wasSpeaking = false

  async push() {
    // Edge-triggered like Silero: SpeechEnd only on speaking → pause.
    const speechEnded = this.wasSpeaking && !this.speaking
    this.wasSpeaking = this.speaking
    return { speaking: this.speaking, speechEnded }
  }

  reset(): void {
    this.speaking = false
    this.wasSpeaking = false
  }
}

function createSession(opts: {
  endpointer?: PreviewEndpointer
  transcribe?: (audio: Float32Array, language: string) => Promise<string>
  requestStop?: () => void
} = {}) {
  const events: WorkerEvent[] = []
  const requestStop = opts.requestStop ?? vi.fn()
  const session = new TranscriptionSession(
    's1',
    'en',
    opts.transcribe ?? (async () => 'hello world'),
    async audio => audio,
    opts.endpointer ?? openEndpointer(),
    event => events.push(event),
    requestStop,
  )
  return { session, events, requestStop }
}

async function flush() {
  for (let i = 0; i < 10; i++)
    await Promise.resolve()
}

describe('openEndpointer', () => {
  it('reports a single speechEnded then stays quiet until reset', async () => {
    const ep = openEndpointer()
    expect(await ep.push(new Float32Array(100))).toEqual({ speaking: false, speechEnded: true })
    expect(await ep.push(new Float32Array(100))).toEqual({ speaking: false, speechEnded: false })
    expect(ep.speaking).toBe(false)
    ep.reset()
    expect(await ep.push(new Float32Array(100))).toEqual({ speaking: false, speechEnded: true })
  })
})

describe('transcriptionSession previews', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not emit a partial while Silero reports speaking', async () => {
    const endpointer = new FakeEndpointer()
    endpointer.speaking = true
    const { session, events } = createSession({ endpointer })

    session.addPcm(speechChunk(0.6))
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()

    expect(events.filter(e => e.type === 'partial')).toEqual([])
  })

  it('emits a partial after the interval when a pause is reported', async () => {
    const endpointer = new FakeEndpointer()
    endpointer.speaking = true
    const { session, events } = createSession({ endpointer })

    session.addPcm(speechChunk(0.6))
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(events.filter(e => e.type === 'partial')).toEqual([])

    endpointer.speaking = false
    session.addPcm(speechChunk(0.1, 0))
    await flush()

    const partials = events.filter(e => e.type === 'partial')
    expect(partials).toHaveLength(1)
    expect(partials[0]).toMatchObject({ type: 'partial', sessionId: 's1', text: 'hello world' })
  })

  it('does not re-preview during continued silence even if ASR text drifts', async () => {
    let n = 0
    const endpointer = new FakeEndpointer()
    endpointer.speaking = true
    const { session, events } = createSession({
      endpointer,
      transcribe: async () => `partial-${++n}`,
    })

    session.addPcm(speechChunk(0.6))
    await flush()
    endpointer.speaking = false
    session.addPcm(speechChunk(0.1, 0))
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(events.filter(e => e.type === 'partial')).toHaveLength(1)

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      session.addPcm(speechChunk(0.1, 0))
      await flush()
    }
    expect(events.filter(e => e.type === 'partial')).toHaveLength(1)
  })

  it('previews again after a new speech segment once the interval elapses', async () => {
    let n = 0
    const endpointer = new FakeEndpointer()
    endpointer.speaking = true
    const { session, events } = createSession({
      endpointer,
      transcribe: async () => `partial-${++n}`,
    })

    session.addPcm(speechChunk(0.6))
    await flush()
    endpointer.speaking = false
    session.addPcm(speechChunk(0.1, 0))
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(events.filter(e => e.type === 'partial')).toHaveLength(1)

    endpointer.speaking = true
    session.addPcm(speechChunk(0.5))
    await flush()
    endpointer.speaking = false
    session.addPcm(speechChunk(0.1, 0))
    await flush()
    expect(events.filter(e => e.type === 'partial')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(999)
    await flush()
    expect(events.filter(e => e.type === 'partial')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    await flush()
    if (events.filter(e => e.type === 'partial').length < 2) {
      session.addPcm(speechChunk(0.1, 0))
      await flush()
    }
    expect(events.filter(e => e.type === 'partial')).toHaveLength(2)
  })

  it('does not emit partials after stopPreviews', async () => {
    const endpointer = new FakeEndpointer()
    endpointer.speaking = true
    const { session, events } = createSession({ endpointer })

    session.addPcm(speechChunk(0.6))
    await flush()
    endpointer.speaking = false
    session.addPcm(speechChunk(0.1, 0))
    await flush()
    session.stopPreviews()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()

    expect(events.filter(e => e.type === 'partial')).toEqual([])
  })

  it('finalize still produces final after previews are closed', async () => {
    const endpointer = new FakeEndpointer()
    const { session, events } = createSession({
      endpointer,
      transcribe: async () => 'final text',
    })

    session.addPcm(speechChunk(0.5))
    await flush()
    await session.finalize()

    expect(events.filter(e => e.type === 'final')).toEqual([
      { type: 'final', sessionId: 's1', text: 'final text' },
    ])
  })

  it('auto-stops after continuous silence of 5s', async () => {
    const endpointer = new FakeEndpointer()
    endpointer.speaking = true
    const { session, requestStop } = createSession({ endpointer })

    session.addPcm(speechChunk(0.6))
    await flush()
    endpointer.speaking = false
    session.addPcm(speechChunk(0.1, 0))
    await flush()

    await vi.advanceTimersByTimeAsync(SILENCE_AUTO_STOP_MS - 1)
    expect(requestStop).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(requestStop).toHaveBeenCalledTimes(1)
  })

  it('does not auto-stop while speaking, and restarts the silence clock after speech ends', async () => {
    const endpointer = new FakeEndpointer()
    endpointer.speaking = true
    const { session, requestStop } = createSession({ endpointer })

    session.addPcm(speechChunk(0.6))
    await flush()
    await vi.advanceTimersByTimeAsync(SILENCE_AUTO_STOP_MS)
    expect(requestStop).not.toHaveBeenCalled()

    endpointer.speaking = false
    session.addPcm(speechChunk(0.1, 0))
    await flush()
    await vi.advanceTimersByTimeAsync(SILENCE_AUTO_STOP_MS - 1)
    expect(requestStop).not.toHaveBeenCalled()

    endpointer.speaking = true
    session.addPcm(speechChunk(0.3))
    await flush()
    await vi.advanceTimersByTimeAsync(SILENCE_AUTO_STOP_MS)
    expect(requestStop).not.toHaveBeenCalled()

    endpointer.speaking = false
    session.addPcm(speechChunk(0.1, 0))
    await flush()
    await vi.advanceTimersByTimeAsync(SILENCE_AUTO_STOP_MS)
    expect(requestStop).toHaveBeenCalledTimes(1)
  })

  it('auto-stops on initial silence when nothing is ever said', async () => {
    const endpointer = new FakeEndpointer()
    const { requestStop } = createSession({ endpointer })

    await vi.advanceTimersByTimeAsync(SILENCE_AUTO_STOP_MS - 1)
    expect(requestStop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(requestStop).toHaveBeenCalledTimes(1)
  })

  it('does not auto-stop after previews are closed', async () => {
    const endpointer = new FakeEndpointer()
    const { session, requestStop } = createSession({ endpointer })

    session.stopPreviews()
    await vi.advanceTimersByTimeAsync(SILENCE_AUTO_STOP_MS)
    expect(requestStop).not.toHaveBeenCalled()
  })
})
