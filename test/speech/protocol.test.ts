import { describe, expect, it } from 'vitest'
import { parseHelperEvent, ProtocolError } from '../../src/speech/protocol'

describe('parseHelperEvent', () => {
  it('parses final transcript events', () => {
    expect(parseHelperEvent('{"type":"final","sessionId":"one","text":"hello"}')).toEqual({
      type: 'final',
      sessionId: 'one',
      text: 'hello',
    })
  })

  it('rejects malformed protocol messages', () => {
    expect(() => parseHelperEvent('{"type":"partial","sessionId":42}')).toThrow(ProtocolError)
  })
})
