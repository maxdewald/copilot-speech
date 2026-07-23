export type InferenceDevice = 'auto' | 'gpu' | 'cpu'

export interface WorkerData {
  helperPath: string
  vadModelPath: string
  modelId: string
  dtype: string
  cacheDir: string
  device: InferenceDevice
}

export interface DaemonData extends WorkerData {
  socketPath: string
  idleUnloadMs: number
}

export const DAEMON_PROTOCOL_VERSION = 1

export type WorkerCommand
  = | { type: 'start', sessionId: string, language: string }
    | { type: 'stop', sessionId: string }
    | { type: 'cancel', sessionId: string }
    | { type: 'unloadModel' }

export type DaemonCommand
  = | { type: 'hello', protocolVersion: number }
    | { type: 'shutdown' }
    | WorkerCommand

export type WorkerEvent
  = | { type: 'modelProgress', message: string, file?: string, loaded?: number, total?: number, level?: 'info' | 'warning' | 'debug' }
    | { type: 'recording', sessionId: string }
    | { type: 'partial', sessionId: string, text: string }
    | { type: 'final', sessionId: string, text: string }
    | { type: 'cancelled', sessionId: string }
    | { type: 'error', code: string, message: string, sessionId?: string }

export type DaemonEvent
  = | { type: 'hello', protocolVersion: number }
    | { type: 'shutdownResult', ok: boolean, message?: string }
    | WorkerEvent

export function parseDaemonCommand(line: string): DaemonCommand {
  const value: unknown = JSON.parse(line)
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Daemon command must be an object.')
  const command = value as Record<string, unknown>
  if (typeof command.type !== 'string')
    throw new Error('Daemon command type must be a string.')

  switch (command.type) {
    case 'hello':
      if (typeof command.protocolVersion !== 'number')
        throw new Error('Daemon protocol version must be a number.')
      return { type: 'hello', protocolVersion: command.protocolVersion }
    case 'start':
      if (typeof command.sessionId !== 'string' || typeof command.language !== 'string')
        throw new Error('Start requires sessionId and language.')
      return { type: 'start', sessionId: command.sessionId, language: command.language }
    case 'stop':
    case 'cancel':
      if (typeof command.sessionId !== 'string')
        throw new Error(`${command.type} requires sessionId.`)
      return { type: command.type, sessionId: command.sessionId }
    case 'unloadModel':
      return { type: 'unloadModel' }
    case 'shutdown':
      return { type: 'shutdown' }
    default:
      throw new Error(`Unknown daemon command: ${command.type}`)
  }
}

export function parseDaemonEvent(line: string): DaemonEvent {
  const value: unknown = JSON.parse(line)
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Daemon event must be an object.')
  const event = value as Record<string, unknown>
  if (event.type === 'hello' && typeof event.protocolVersion === 'number')
    return { type: 'hello', protocolVersion: event.protocolVersion }
  if (event.type === 'shutdownResult' && typeof event.ok === 'boolean') {
    if (event.message !== undefined && typeof event.message !== 'string')
      throw new Error('Daemon shutdown result message must be a string.')
    return {
      type: 'shutdownResult',
      ok: event.ok,
      ...(event.message === undefined ? {} : { message: event.message }),
    }
  }
  if (typeof event.type !== 'string')
    throw new Error('Daemon event type must be a string.')
  return value as WorkerEvent
}
