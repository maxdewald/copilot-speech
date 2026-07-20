import type { ExtensionContext } from 'vscode'
import { join } from 'node:path'
import process from 'node:process'
import { env, UIKind, window, workspace } from 'vscode'
import { deliverToChat } from './chat-delivery'
import { registerCommands } from './commands'
import { DictationSession } from './dictation-session'
import { createStatusBar } from './status-bar'
import { WorkerSpeechEngine } from './worker-speech-engine'

const MODEL_ID = 'onnx-community/cohere-transcribe-03-2026-ONNX'
const MODEL_DTYPE = 'q4f16'

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel('Copilot Speech', { log: true })
  output.info(`Activating Copilot Speech on ${process.platform}-${process.arch}.`)

  const resolveHelperPath = (): string => {
    const configuredPath = workspace.getConfiguration('copilotSpeech').get('helperPath', '').trim()
    if (configuredPath)
      return configuredPath
    const executable = process.platform === 'win32' ? 'copilot-speech-helper.exe' : 'copilot-speech-helper'
    return context.asAbsolutePath(`dist/native/runtime/${process.platform}-${process.arch}/${executable}`)
  }

  const engine = new WorkerSpeechEngine(
    {
      workerPath: context.asAbsolutePath(join('dist', 'extension', 'transcription-worker.cjs')),
      helperPath: resolveHelperPath(),
      vadModelPath: context.asAbsolutePath(join('node_modules', '@ricky0123', 'vad-web', 'dist', 'silero_vad_legacy.onnx')),
      modelId: MODEL_ID,
      dtype: MODEL_DTYPE,
      cacheDir: join(context.globalStorageUri.fsPath, 'models'),
    },
    output,
  )
  const session = new DictationSession(engine, deliverToChat, output)
  const statusBar = createStatusBar(session)

  context.subscriptions.push(
    output,
    engine,
    session,
    statusBar,
    ...registerCommands(session, output),
  )

  statusBar.show()

  if (env.uiKind !== UIKind.Desktop)
    void window.showWarningMessage('Copilot Speech requires desktop VS Code because transcription runs beside your local microphone.')
}
