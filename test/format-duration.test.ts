import { describe, expect, it } from 'vitest'
import { formatDuration } from '../src/format-duration'

describe('formatDuration', () => {
  it('formats sub-second values as whole milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(42)).toBe('42ms')
    expect(formatDuration(999.4)).toBe('999ms')
  })

  it('formats one second and above with one decimal second', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(8200)).toBe('8.2s')
  })

  it('treats invalid values as 0ms', () => {
    expect(formatDuration(Number.NaN)).toBe('0ms')
    expect(formatDuration(-5)).toBe('0ms')
  })
})
