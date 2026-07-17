import type { ExtensionContext } from 'vscode'
import { env, UIKind, window, workspace } from 'vscode'
import { ChatTranscriptDelivery } from './delivery/chat'
import { registerCommands } from './extension/commands'
import { createStatusBar } from './extension/status'
import { HelperSupervisor } from './speech/helper-supervisor'
import { DictationSession } from './speech/session'

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel('Copilot Speech', { log: true })
  const helper = new HelperSupervisor(
    () => workspace.getConfiguration('copilotSpeech').get('helperPath', ''),
    output,
  )
  const delivery = new ChatTranscriptDelivery()
  const session = new DictationSession(helper, delivery, output)
  const statusBar = createStatusBar(session)

  context.subscriptions.push(
    output,
    helper,
    session,
    statusBar,
    ...registerCommands(session, helper, output),
  )

  statusBar.show()

  if (env.uiKind !== UIKind.Desktop)
    void window.showWarningMessage('Copilot Speech requires desktop VS Code because transcription runs beside your local microphone.')
}

export function deactivate(): void {}
