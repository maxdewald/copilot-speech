import type { NonRealTimeVAD } from '@ricky0123/vad-web'
import { Buffer as nodeBuffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

const SAMPLE_RATE = 16000

/** Decode a base64 string into interleaved little-endian Int16 PCM as Float32. */
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

/**
 * Silero VAD wrapper used by the transcription worker. Runs non-realtime over a
 * finished capture buffer and returns only the speech-bearing samples, which
 * improves ASR quality versus energy thresholding.
 */
export class SileroVad {
  private constructor(private readonly vad: NonRealTimeVAD) {}

  static async create(modelPath: string): Promise<SileroVad> {
    const { NonRealTimeVAD } = await import('@ricky0123/vad-web')
    const vad = await NonRealTimeVAD.new({
      modelURL: modelPath,
      modelFetcher: async (path) => {
        const buffer = await readFile(path)
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      },
    })
    return new SileroVad(vad)
  }

  /**
   * Extract speech segments from a mono Float32 buffer and concatenate them.
   * Returns an empty buffer when no speech is detected.
   */
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

    const joined = new Float32Array(total)
    let offset = 0
    for (const segment of segments) {
      joined.set(segment, offset)
      offset += segment.length
    }
    return joined
  }
}
