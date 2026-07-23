import { describe, expect, it } from 'vitest'
import { DAEMON_PROTOCOL_VERSION, parseDaemonCommand, parseDaemonEvent } from '../src/worker-protocol'

describe('shared speech daemon protocol', () => {
  it('parses the handshake and rejects malformed commands', () => {
    expect(parseDaemonCommand(JSON.stringify({
      type: 'hello',
      protocolVersion: DAEMON_PROTOCOL_VERSION,
    }))).toEqual({ type: 'hello', protocolVersion: DAEMON_PROTOCOL_VERSION })

    expect(parseDaemonEvent(JSON.stringify({
      type: 'recording',
      sessionId: 's1',
    }))).toEqual({ type: 'recording', sessionId: 's1' })

    expect(() => parseDaemonCommand('{"type":"start"}')).toThrow('Start requires sessionId and language.')
    expect(() => parseDaemonCommand('{"type":"unknown"}')).toThrow('Unknown daemon command: unknown')
  })
})
