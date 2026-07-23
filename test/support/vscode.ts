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
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
} as unknown as vscode.LogOutputChannel

let editorText: string | undefined
let replaceNextType = false

export const window = {
  get activeTextEditor(): MockTextEditor | undefined {
    if (editorText === undefined)
      return undefined
    return {
      document: {
        getText: () => editorText ?? '',
      },
    }
  },
  set activeTextEditor(value: MockTextEditor | undefined) {
    editorText = value?.document.getText()
  },
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
  executeCommand: vi.fn(async (command: string, ...args: unknown[]) => {
    if (command === 'type') {
      const text = (args[0] as { text?: string } | undefined)?.text ?? ''
      if (editorText === undefined) {
        editorText = text
      }
      else if (replaceNextType) {
        editorText = text
        replaceNextType = false
      }
      else {
        editorText += text
      }
      return undefined
    }
    if (command === 'editor.action.selectAll') {
      replaceNextType = true
      return undefined
    }
    if (command === 'deleteRight') {
      if (replaceNextType) {
        editorText = ''
        replaceNextType = false
      }
      return undefined
    }
    if (command === 'cursorMove') {
      const opts = args[0] as { to?: string, by?: string, value?: number, select?: boolean } | undefined
      if (opts?.to === 'left' && opts.select === true && editorText !== undefined && editorText.length > 0) {
        const n = Math.min(opts.value ?? 1, editorText.length)
        editorText = editorText.slice(0, -n)
      }
      return undefined
    }
    if (command === 'deleteLeft') {
      // Selection was already removed by cursorMove+select in tests.
      return undefined
    }
    return undefined
  }),
}

export function setActiveTextEditorContent(text: string | undefined): void {
  editorText = text
}

export function getActiveTextEditorContent(): string | undefined {
  return editorText
}

export function resetVSCodeMock(): void {
  commands.available = []
  editorText = undefined
  replaceNextType = false
  vi.clearAllMocks()
}
