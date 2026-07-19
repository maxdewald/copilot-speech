import type { Disposable, ExtensionContext } from 'vscode'
import type { DictationSession } from './dictation-session'
import { commands, window, workspace } from 'vscode'
import { ensureModel } from './model-download'

export function registerCommands(context: ExtensionContext, session: DictationSession): Disposable[] {
  return [
    commands.registerCommand('copilotSpeech.startChatDictation', async () => {
      const configuration = workspace.getConfiguration('copilotSpeech')
      try {
        await session.start(async signal => ({
          modelPath: configuration.get('modelPath', '') || await ensureModel(context, signal),
        }))
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
