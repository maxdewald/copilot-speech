import type { FrameProcessor, NonRealTimeVAD } from '@ricky0123/vad-web'
import { Buffer as nodeBuffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

const SAMPLE_RATE = 16000
/** Short pause before SpeechEnd for live previews (package default is 1400ms). */
const PREVIEW_REDEMPTION_MS = 300

export function decodePcm16(base64: string): Float32Array {
  const bytes = nodeBuffer.from(base64, 'base64')
  const count = Math.floor(bytes.length / 2)
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const value = bytes.readInt16LE(i * 2)
    out[i] = value / 32768
  }
  return out
}

async function loadModelBytes(path: string): Promise<ArrayBuffer> {
  const buffer = await readFile(path)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

export class SileroVad {
  private constructor(private readonly vad: NonRealTimeVAD) {}

  static async create(modelPath: string): Promise<SileroVad> {
    const { NonRealTimeVAD } = await import('@ricky0123/vad-web')
    const vad = await NonRealTimeVAD.new({
      modelURL: modelPath,
      modelFetcher: loadModelBytes,
    })
    return new SileroVad(vad)
  }

  async extractSpeech(audio: Float32Array, sampleRate = SAMPLE_RATE): Promise<Float32Array> {
    if (audio.length === 0)
      return new Float32Array(0)

    const segments: Float32Array[] = []
    let total = 0
    for await (const segment of this.vad.run(audio, sampleRate)) {
      segments.push(segment.audio)
      total += segment.audio.length
    }
    if (total === 0)
      return new Float32Array(0)

    // Hard-joining VAD cuts glues boundary words ("telling"+"Work" → "tellingWork").
    // A short silence pad restores a natural pause for the ASR model.
    const gapSamples = segments.length > 1 ? Math.floor(0.2 * sampleRate) : 0
    const joined = new Float32Array(total + gapSamples * Math.max(0, segments.length - 1))
    let offset = 0
    for (let i = 0; i < segments.length; i++) {
      if (i > 0)
        offset += gapSamples
      const segment = segments[i]!
      joined.set(segment, offset)
      offset += segment.length
    }
    return joined
  }
}

/** Streaming Silero pause detector for preview gating. */
export class SileroEndpointer {
  private readonly residual: number[] = []
  speaking = false
  private readonly SpeechStart: string
  private readonly SpeechEnd: string

  private constructor(
    private readonly vad: NonRealTimeVAD,
    messages: { SpeechStart: string, SpeechEnd: string },
  ) {
    this.SpeechStart = messages.SpeechStart
    this.SpeechEnd = messages.SpeechEnd
  }

  static async create(modelPath: string): Promise<SileroEndpointer> {
    const { NonRealTimeVAD, Message } = await import('@ricky0123/vad-web')
    const vad = await NonRealTimeVAD.new({
      modelURL: modelPath,
      modelFetcher: loadModelBytes,
      redemptionMs: PREVIEW_REDEMPTION_MS,
      preSpeechPadMs: 30,
      minSpeechMs: 100,
    })
    return new SileroEndpointer(vad, Message)
  }

  async push(samples: Float32Array): Promise<{ speaking: boolean, speechEnded: boolean }> {
    for (let i = 0; i < samples.length; i++)
      this.residual.push(samples[i] ?? 0)

    let speechEnded = false
    const frameSamples = this.vad.frameSamples
    const processor = this.vad.frameProcessor

    while (this.residual.length >= frameSamples) {
      const frame = Float32Array.from(this.residual.splice(0, frameSamples))
      await processor.process(frame, (event) => {
        if (event.msg === this.SpeechStart) {
          this.speaking = true
        }
        else if (event.msg === this.SpeechEnd) {
          this.speaking = false
          speechEnded = true
        }
      })
    }

    return { speaking: this.speaking, speechEnded }
  }

  reset(): void {
    this.residual.length = 0
    this.speaking = false
    ;(this.vad.frameProcessor as FrameProcessor).reset()
  }
}

/** Stub: one SpeechEnd per session (tests / COPILOT_SPEECH_STUB_TRANSCRIPT). */
export function openEndpointer(): {
  speaking: boolean
  push: (samples: Float32Array) => Promise<{ speaking: boolean, speechEnded: boolean }>
  reset: () => void
} {
  let ended = false
  return {
    speaking: false,
    async push(_samples: Float32Array) {
      const speechEnded = !ended
      ended = true
      return { speaking: false, speechEnded }
    },
    reset() {
      ended = false
    },
  }
}
