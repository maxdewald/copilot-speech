import type { ExtensionContext } from 'vscode'
import process from 'node:process'
import { commands, env, UIKind, window, workspace } from 'vscode'
import { deliverToChat } from './chat-delivery'
import { registerCommands } from './commands'
import { DictationSession } from './dictation-session'
import { HelperSupervisor } from './helper-process'
import { createStatusBar } from './status-bar'

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel('Copilot Speech', { log: true })
  output.info(`Activating Copilot Speech on ${process.platform}-${process.arch}.`)
  const helper = new HelperSupervisor(
    () => {
      const configuredPath = workspace.getConfiguration('copilotSpeech').get('helperPath', '').trim()
      if (configuredPath)
        return configuredPath
      const executable = process.platform === 'win32' ? 'copilot-speech-helper.exe' : 'copilot-speech-helper'
      return context.asAbsolutePath(`dist/native/runtime/${process.platform}-${process.arch}/${executable}`)
    },
    output,
  )
  const session = new DictationSession(helper, deliverToChat, output)
  const commandDisposables = registerCommands(context, session, output)
  const updateContext = (state: string): void => {
    void commands.executeCommand('setContext', 'copilotSpeech.active', !['idle', 'error'].includes(state))
    void commands.executeCommand('setContext', 'copilotSpeech.recording', state === 'recording')
  }
  updateContext(session.state.state)
  const contextSubscription = session.onDidChangeState(snapshot => updateContext(snapshot.state))
  const statusBar = createStatusBar(session)

  context.subscriptions.push(
    output,
    helper,
    session,
    contextSubscription,
    statusBar,
    ...commandDisposables,
  )

  statusBar.show()

  if (env.uiKind !== UIKind.Desktop)
    void window.showWarningMessage('Copilot Speech requires desktop VS Code because transcription runs beside your local microphone.')
}
