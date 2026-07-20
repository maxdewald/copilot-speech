import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { decodePcm16 } from '../src/silero-vad'

describe('decodePcm16', () => {
  it('decodes little-endian int16 samples to floats', () => {
    // 0x0000 -> 0, 0x7FFF -> ~1, 0x8000 -> -1
    const base64 = Buffer.from(Int16Array.from([0, 32767, -32768]).buffer).toString('base64')
    const decoded = decodePcm16(base64)
    expect(decoded.length).toBe(3)
    expect(decoded[0]).toBeCloseTo(0, 5)
    expect(decoded[1]).toBeCloseTo(0.99997, 3)
    expect(decoded[2]).toBeCloseTo(-1, 5)
  })
})
