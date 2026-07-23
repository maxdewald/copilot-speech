import type { Socket } from 'node:net'
import type { DaemonCommand, DaemonData, DaemonEvent, WorkerEvent } from './worker-protocol'
import { Buffer } from 'node:buffer'
import { chmodSync, rmSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { TranscriptionWorker } from './transcription-worker'
import { DAEMON_PROTOCOL_VERSION, parseDaemonCommand } from './worker-protocol'

const MAX_LINE_BYTES = 2 * 1024 * 1024

const data = JSON.parse(process.env.COPILOT_SPEECH_DAEMON_DATA ?? '') as DaemonData
const clients = new Set<Socket>()
const runtime = new TranscriptionWorker(data, routeEvent)
let owner: Socket | undefined
let activeSessionId: string | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined

const server = createServer((socket) => {
  clients.add(socket)
  const lines = createInterface({ input: socket })
  lines.on('line', (line) => {
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      socket.destroy()
      return
    }
    try {
      void handle(socket, parseDaemonCommand(line))
    }
    catch (error) {
      send(socket, { type: 'error', code: 'protocol_error', message: error instanceof Error ? error.message : String(error) })
    }
  })
  socket.on('close', () => {
    lines.close()
    clients.delete(socket)
    if (owner === socket) {
      const sessionId = activeSessionId
      if (sessionId !== undefined)
        void runtime.handle({ type: 'cancel', sessionId })
    }
    if (clients.size === 0)
      shutdown()
  })
})

async function handle(socket: Socket, command: DaemonCommand): Promise<void> {
  if (command.type === 'hello') {
    if (command.protocolVersion !== DAEMON_PROTOCOL_VERSION) {
      send(socket, { type: 'error', code: 'protocol_mismatch', message: `Daemon protocol ${DAEMON_PROTOCOL_VERSION} is incompatible with client protocol ${command.protocolVersion}.` })
      socket.end()
      return
    }
    send(socket, { type: 'hello', protocolVersion: DAEMON_PROTOCOL_VERSION })
    return
  }

  if (command.type === 'shutdown') {
    if (owner) {
      send(socket, { type: 'shutdownResult', ok: false, message: 'Copilot Speech is active in another VS Code window.' })
      return
    }
    socket.write(`${JSON.stringify({ type: 'shutdownResult', ok: true } satisfies DaemonEvent)}\n`, shutdown)
    return
  }

  if (command.type === 'start') {
    if (owner && owner !== socket) {
      send(socket, { type: 'error', code: 'busy', message: 'Copilot Speech is already active in another VS Code window.', sessionId: command.sessionId })
      return
    }
    owner = socket
    activeSessionId = command.sessionId
    clearIdleTimer()
  }
  else if (command.type === 'stop' || command.type === 'cancel') {
    if (owner !== socket || activeSessionId !== command.sessionId)
      return
  }
  await runtime.handle(command)
}

function routeEvent(event: WorkerEvent): void {
  if (owner)
    send(owner, event)
  if (event.type === 'final' || event.type === 'cancelled' || event.type === 'error') {
    if (event.type === 'error' && event.sessionId !== undefined && event.sessionId !== activeSessionId)
      return
    owner = undefined
    activeSessionId = undefined
    armIdleTimer()
  }
}

function send(socket: Socket, event: DaemonEvent): void {
  if (socket.writable)
    socket.write(`${JSON.stringify(event)}\n`)
}

function armIdleTimer(): void {
  clearIdleTimer()
  if (data.idleUnloadMs > 0)
    idleTimer = setTimeout(shutdown, data.idleUnloadMs)
}

function clearIdleTimer(): void {
  if (idleTimer !== undefined)
    clearTimeout(idleTimer)
  idleTimer = undefined
}

function shutdown(): void {
  clearIdleTimer()
  runtime.dispose()
  for (const client of clients)
    client.destroy()
  server.close(() => process.exit(0))
}

function listen(): void {
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EADDRINUSE')
      throw error
    const probe = createConnection(data.socketPath)
    probe.once('connect', () => process.exit(0))
    probe.once('error', () => {
      if (process.platform !== 'win32')
        rmSync(data.socketPath, { force: true })
      setImmediate(() => server.listen(data.socketPath))
    })
  })
  server.listen(data.socketPath, () => {
    if (process.platform !== 'win32')
      chmodSync(data.socketPath, 0o600)
    armIdleTimer()
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
listen()
