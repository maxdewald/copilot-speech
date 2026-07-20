import { describe, expect, it } from 'vitest'
import { parseHelperEvent, ProtocolError } from '../src/helper-protocol'

describe('parseHelperEvent', () => {
  it('parses pcm events', () => {
    expect(parseHelperEvent('{"type":"pcm","sessionId":"one","data":"AAA="}')).toEqual({
      type: 'pcm',
      sessionId: 'one',
      data: 'AAA=',
    })
  })

  it('parses stopped events', () => {
    expect(parseHelperEvent('{"type":"stopped","sessionId":"one"}')).toEqual({
      type: 'stopped',
      sessionId: 'one',
    })
  })

  it('rejects malformed protocol messages', () => {
    expect(() => parseHelperEvent('{"type":"pcm","sessionId":42}')).toThrow(ProtocolError)
  })

  it('rejects removed event types', () => {
    expect(() => parseHelperEvent('{"type":"final","sessionId":"one","text":"hi"}')).toThrow(ProtocolError)
  })
})
