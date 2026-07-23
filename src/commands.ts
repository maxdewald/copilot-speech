import type { Disposable, LogOutputChannel } from 'vscode'
import type { DictationSession } from './dictation-session'
import { commands, window, workspace } from 'vscode'

const SPEECH_LANGUAGES = [
  'en',
  'fr',
  'de',
  'it',
  'es',
  'pt',
  'nl',
  'pl',
  'el',
  'ar',
  'ja',
  'zh',
  'vi',
  'ko',
] as const

type SpeechLanguage = typeof SPEECH_LANGUAGES[number]

function normalizeLanguage(value: string): SpeechLanguage {
  return (SPEECH_LANGUAGES as readonly string[]).includes(value)
    ? value as SpeechLanguage
    : 'en'
}

export function registerCommands(
  session: DictationSession,
  output: LogOutputChannel,
  ensureConsent: () => Promise<boolean>,
  deleteModel: () => Promise<boolean>,
): Disposable[] {
  return [
    commands.registerCommand('copilotSpeech.startChatDictation', async () => {
      const configuration = workspace.getConfiguration('copilotSpeech')
      output.info('Start dictation requested.')
      try {
        await session.start(async () => {
          if (!await ensureConsent()) {
            output.info('Model download declined; dictation cancelled.')
            const abort = new Error('Model download declined.')
            abort.name = 'AbortError'
            throw abort
          }
          return { language: normalizeLanguage(configuration.get('language', 'en')) }
        })
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
    commands.registerCommand('copilotSpeech.openSpeechSettings', () => commands.executeCommand('workbench.action.openSettings', '@ext:maxdewald.copilot-speech')),
    commands.registerCommand('copilotSpeech.deleteModel', async () => {
      const confirm = 'Delete Model'
      const choice = await window.showWarningMessage(
        'Delete the downloaded Cohere Transcribe speech model? It will be re-downloaded (~1.5 GB) on your next dictation.',
        { modal: true },
        confirm,
      )
      if (choice !== confirm)
        return
      try {
        const existed = await deleteModel()
        output.info(existed ? 'Deleted downloaded speech model.' : 'No downloaded speech model found.')
        void window.showInformationMessage(
          existed ? 'Copilot Speech model deleted. It will re-download on the next dictation.' : 'No downloaded Copilot Speech model was found.',
        )
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        output.error(`Could not delete speech model: ${message}`)
        void window.showErrorMessage(`Copilot Speech could not delete the model: ${message}`)
      }
    }),
  ]
}
