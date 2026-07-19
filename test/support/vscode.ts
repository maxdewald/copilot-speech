import type * as vscode from 'vscode'
import { createVSCodeMock } from 'jest-mock-vscode'
import { vi } from 'vitest'

const base = createVSCodeMock(vi) as unknown as typeof vscode

export const { EventEmitter, StatusBarAlignment, ThemeColor, ConfigurationTarget, ProgressLocation } = base

export enum UIKind {
  Desktop = 1,
  Web = 2,
}

class MockDisposable {
  constructor(private readonly callback: () => void = () => {}) {}
  dispose(): void {
    this.callback()
  }
}

const settings = new Map<string, unknown>()
const commandHandlers = new Map<string, (...args: unknown[]) => unknown>()

export const output = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  append: vi.fn(),
  appendLine: vi.fn(),
  replace: vi.fn(),
  clear: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
  name: 'Copilot Speech',
  logLevel: 2,
  onDidChangeLogLevel: vi.fn(),
}

export const statusBarItem = {
  text: '',
  name: '',
  tooltip: undefined as string | vscode.MarkdownString | undefined,
  command: undefined as string | vscode.Command | undefined,
  backgroundColor: undefined as vscode.ThemeColor | undefined,
  accessibilityInformation: undefined as vscode.AccessibilityInformation | undefined,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
}

export const window = {
  createOutputChannel: vi.fn(() => output),
  createStatusBarItem: vi.fn(() => statusBarItem),
  showInformationMessage: vi.fn(async () => undefined as string | undefined),
  showWarningMessage: vi.fn(async () => undefined as string | undefined),
  showErrorMessage: vi.fn(async () => undefined as string | undefined),
  showQuickPick: vi.fn(async () => undefined as unknown),
  withProgress: vi.fn(async (_options: unknown, task: (progress: { report: (value: unknown) => void }, token: { isCancellationRequested: boolean, onCancellationRequested: () => MockDisposable }) => Promise<unknown>) => task(
    { report: vi.fn() },
    { isCancellationRequested: false, onCancellationRequested: () => new MockDisposable() },
  )),
}

export const workspace = {
  getConfiguration: vi.fn((section: string) => ({
    get<T>(key: string, fallback?: T): T {
      const value = settings.get(`${section}.${key}`)
      return (value === undefined ? fallback : value) as T
    },
    async update(key: string, value: unknown): Promise<void> {
      settings.set(`${section}.${key}`, value)
    },
  })),
}

export const env = {
  uiKind: UIKind.Desktop,
  clipboard: {
    writeText: vi.fn(async () => {}),
    readText: vi.fn(async () => ''),
  },
}

export const commands = {
  available: [] as string[],
  registerCommand: vi.fn((command: string, handler: (...args: unknown[]) => unknown) => {
    commandHandlers.set(command, handler)
    return new MockDisposable(() => commandHandlers.delete(command))
  }),
  getCommands: vi.fn(async () => commands.available),
  executeCommand: vi.fn(async (command: string, ...args: unknown[]) =>
    commandHandlers.get(command)?.(...args)),
}

export function resetVSCodeMock(): void {
  settings.clear()
  commandHandlers.clear()
  commands.available = []
  vi.clearAllMocks()
  env.uiKind = UIKind.Desktop
  statusBarItem.text = ''
  statusBarItem.name = ''
  statusBarItem.tooltip = undefined
  statusBarItem.command = undefined
  statusBarItem.backgroundColor = undefined
  statusBarItem.accessibilityInformation = undefined
}
