export const PROTOCOL_VERSION = 3

export type HelperCommand
  = | { type: 'hello', protocolVersion: number }
    | { type: 'start', sessionId: string }
    | { type: 'stop', sessionId: string }
    | { type: 'cancel', sessionId: string }

export type HelperEvent
  = | { type: 'hello', protocolVersion: number, helperVersion: string }
    | { type: 'recording', sessionId: string }
    | { type: 'pcm', sessionId: string, data: string }
    | { type: 'stopped', sessionId: string }
    | { type: 'error', code: string, message: string, sessionId?: string }

export class ProtocolError extends Error {}

export function parseHelperEvent(line: string): HelperEvent {
  let value: unknown
  try {
    value = JSON.parse(line)
  }
  catch (error) {
    throw new ProtocolError(`Helper emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  const event = asRecord(value)
  const type = requiredString(event, 'type')

  switch (type) {
    case 'hello':
      return {
        type,
        protocolVersion: requiredNumber(event, 'protocolVersion'),
        helperVersion: requiredString(event, 'helperVersion'),
      }
    case 'recording':
    case 'stopped':
      return { type, sessionId: requiredString(event, 'sessionId') }
    case 'pcm':
      return {
        type,
        sessionId: requiredString(event, 'sessionId'),
        data: requiredString(event, 'data'),
      }
    case 'error': {
      const sessionId = optionalString(event, 'sessionId')
      return {
        type,
        code: requiredString(event, 'code'),
        message: requiredString(event, 'message'),
        ...(sessionId === undefined ? {} : { sessionId }),
      }
    }
    default:
      throw new ProtocolError(`Unknown helper event type: ${type}`)
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new ProtocolError('Helper event must be a JSON object.')
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string')
    throw new ProtocolError(`Helper event field "${key}" must be a string.`)
  return value
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined)
    return undefined
  if (typeof value !== 'string')
    throw new ProtocolError(`Helper event field "${key}" must be a string.`)
  return value
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ProtocolError(`Helper event field "${key}" must be a finite number.`)
  return value
}
