import type { ExtensionContext } from 'vscode'
import { join } from 'node:path'
import process from 'node:process'
import { env, UIKind, window, workspace } from 'vscode'
import { ChatDelivery } from './chat-delivery'
import { registerCommands } from './commands'
import { DictationSession } from './dictation-session'
import { deleteDownloadedModel, ensureModelConsent, modelIsCached, registerModelProgressReporter } from './model-download'
import { createStatusBar } from './status-bar'
import { WorkerSpeechEngine } from './worker-speech-engine'

const MODEL_ID = 'onnx-community/cohere-transcribe-03-2026-ONNX'
const MODEL_DTYPE = 'q4f16'

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel('Copilot Speech', { log: true })
  output.info(`Activating Copilot Speech on ${process.platform}-${process.arch}.`)

  const helperExecutable = process.platform === 'win32' ? 'copilot-speech-helper.exe' : 'copilot-speech-helper'
  const cacheDir = join(context.globalStorageUri.fsPath, 'models')
  const idleMinutes = workspace.getConfiguration('copilotSpeech').get('modelIdleMinutes', 15)
  const idleUnloadMs = Number.isFinite(idleMinutes) && idleMinutes > 0
    ? Math.round(idleMinutes * 60_000)
    : 0
  const engine = new WorkerSpeechEngine(
    {
      workerPath: context.asAbsolutePath('dist/extension/transcription-worker.cjs'),
      helperPath: context.asAbsolutePath(`dist/native/runtime/${process.platform}-${process.arch}/${helperExecutable}`),
      vadModelPath: context.asAbsolutePath('dist/extension/silero_vad_legacy.onnx'),
      modelId: MODEL_ID,
      dtype: MODEL_DTYPE,
      cacheDir,
      idleUnloadMs,
    },
    output,
  )
  const session = new DictationSession(engine, new ChatDelivery(), output)
  const statusBar = createStatusBar(session)

  context.subscriptions.push(
    output,
    engine,
    session,
    statusBar,
    registerModelProgressReporter(engine, output, () => modelIsCached(cacheDir, MODEL_ID, MODEL_DTYPE)),
    ...registerCommands(
      session,
      output,
      async () => ensureModelConsent(context, cacheDir, MODEL_ID, MODEL_DTYPE),
      () => deleteDownloadedModel(context, cacheDir, MODEL_ID),
    ),
  )

  statusBar.show()

  if (env.uiKind !== UIKind.Desktop)
    void window.showWarningMessage('Copilot Speech requires desktop VS Code because transcription runs beside your local microphone.')
}
