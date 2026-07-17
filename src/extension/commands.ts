import type { Disposable } from 'vscode'
import type { DictationSession } from '../speech/session'
import { commands, window, workspace } from 'vscode'

export function registerCommands(session: DictationSession): Disposable[] {
  return [
    commands.registerCommand('copilotSpeech.startChatDictation', async () => {
      const configuration = workspace.getConfiguration('copilotSpeech')
      try {
        await session.start({
          modelPath: configuration.get('modelPath', ''),
        })
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const action = await window.showErrorMessage(`Copilot Speech could not start: ${message}`, 'Open Settings')
        if (action === 'Open Settings')
          await commands.executeCommand('workbench.action.openSettings', '@ext:maxdewald.copilot-speech')
      }
    }),
    commands.registerCommand('copilotSpeech.stopDictation', () => session.stop()),
    commands.registerCommand('copilotSpeech.cancelDictation', () => session.cancel()),
  ]
}
