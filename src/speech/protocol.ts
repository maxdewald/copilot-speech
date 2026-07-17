export const PROTOCOL_VERSION = 1

export interface SpeechDevice {
  id: string
  name: string
  isDefault: boolean
}

export type HelperCommand
  = | { type: 'hello', protocolVersion: number }
    | { type: 'initialize', model: string, modelPath: string, deviceId: string }
    | { type: 'listDevices' }
    | { type: 'start', sessionId: string }
    | { type: 'stop', sessionId: string }
    | { type: 'cancel', sessionId: string }
    | { type: 'shutdown' }

export type HelperEvent
  = | { type: 'hello', protocolVersion: number, helperVersion: string, capabilities: string[] }
    | { type: 'ready' }
    | { type: 'devices', devices: SpeechDevice[] }
    | { type: 'recording', sessionId: string }
    | { type: 'level', sessionId: string, sequence: number, value: number }
    | { type: 'partial', sessionId: string, sequence: number, text: string }
    | { type: 'final', sessionId: string, sequence: number, text: string }
    | { type: 'stopped', sessionId: string }
    | { type: 'cancelled', sessionId: string }
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
        capabilities: requiredStringArray(event, 'capabilities'),
      }
    case 'ready':
      return { type }
    case 'devices':
      return { type, devices: requiredDevices(event, 'devices') }
    case 'recording':
    case 'stopped':
    case 'cancelled':
      return { type, sessionId: requiredString(event, 'sessionId') }
    case 'level':
      return {
        type,
        sessionId: requiredString(event, 'sessionId'),
        sequence: requiredNumber(event, 'sequence'),
        value: requiredNumber(event, 'value'),
      }
    case 'partial':
    case 'final':
      return {
        type,
        sessionId: requiredString(event, 'sessionId'),
        sequence: requiredNumber(event, 'sequence'),
        text: requiredString(event, 'text'),
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

function requiredStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string'))
    throw new ProtocolError(`Helper event field "${key}" must be a string array.`)
  return value
}

function requiredDevices(record: Record<string, unknown>, key: string): SpeechDevice[] {
  const value = record[key]
  if (!Array.isArray(value))
    throw new ProtocolError(`Helper event field "${key}" must be an array.`)

  return value.map((item) => {
    const device = asRecord(item)
    const isDefault = device.isDefault
    if (typeof isDefault !== 'boolean')
      throw new ProtocolError('Helper device field "isDefault" must be a boolean.')
    return {
      id: requiredString(device, 'id'),
      name: requiredString(device, 'name'),
      isDefault,
    }
  })
}
