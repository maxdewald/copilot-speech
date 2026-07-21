import type * as vscode from 'vscode'
import { createVSCodeMock } from 'jest-mock-vscode'
import { vi } from 'vitest'

const base = createVSCodeMock(vi) as unknown as typeof vscode

export const { EventEmitter, ProgressLocation } = base

class MockDisposable {
  dispose(): void {}
}

export interface MockTextEditor {
  document: {
    getText: () => string
  }
}

export const output = {
  debug: vi.fn(),
  error: vi.fn(),
} as unknown as vscode.LogOutputChannel

export const window = {
  activeTextEditor: undefined as MockTextEditor | undefined,
  showInformationMessage: vi.fn(async () => undefined as string | undefined),
  showWarningMessage: vi.fn(async () => undefined as string | undefined),
  withProgress: vi.fn(async (_options: unknown, task: (progress: { report: (value: unknown) => void }, token: { isCancellationRequested: boolean, onCancellationRequested: () => MockDisposable }) => Promise<unknown>) => task(
    { report: vi.fn() },
    { isCancellationRequested: false, onCancellationRequested: () => new MockDisposable() },
  )),
}

export const env = {
  clipboard: {
    writeText: vi.fn(async () => {}),
  },
}

export const commands = {
  available: [] as string[],
  getCommands: vi.fn(async () => commands.available),
  executeCommand: vi.fn(async () => undefined),
}

export function setActiveTextEditorContent(text: string | undefined): void {
  if (text === undefined) {
    window.activeTextEditor = undefined
    return
  }
  window.activeTextEditor = {
    document: {
      getText: () => text,
    },
  }
}

export function resetVSCodeMock(): void {
  commands.available = []
  window.activeTextEditor = undefined
  vi.clearAllMocks()
}
