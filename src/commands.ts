import type { Disposable, ExtensionContext, LogOutputChannel } from 'vscode'
import type { DictationSession } from './dictation-session'
import type { SpeechLanguage } from './model-download'
import { commands, window, workspace } from 'vscode'
import { ensureModel } from './model-download'

export function registerCommands(context: ExtensionContext, session: DictationSession, output: LogOutputChannel): Disposable[] {
  return [
    commands.registerCommand('copilotSpeech.startChatDictation', async () => {
      const configuration = workspace.getConfiguration('copilotSpeech')
      output.info('Start dictation requested.')
      try {
        await session.start(async signal => ensureModel(
          context,
          configuration.get<SpeechLanguage>('language', 'en'),
          signal,
          configuration.get('modelPath', ''),
        ))
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        output.error(`Could not start dictation: ${message}`)
        output.show(true)
        const action = await window.showErrorMessage(`Copilot Speech could not start: ${message}`, 'Show Logs', 'Open Settings')
        if (action === 'Show Logs')
          output.show(true)
        if (action === 'Open Settings')
          await commands.executeCommand('workbench.action.openSettings', '@ext:maxdewald.copilot-speech')
      }
    }),
    commands.registerCommand('copilotSpeech.stopDictation', () => session.stop()),
    commands.registerCommand('copilotSpeech.cancelDictation', () => session.cancel()),
    commands.registerCommand('copilotSpeech.showLogs', () => output.show(true)),
  ]
}
