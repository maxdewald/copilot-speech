import type { Disposable, LogOutputChannel } from 'vscode'
import type { DictationSession } from './dictation-session'
import { commands, window, workspace } from 'vscode'

// Languages supported by Cohere Transcribe 03-2026. The model does not auto-detect
// language, so the user picks one and it is passed to the ASR pipeline.
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

export function registerCommands(session: DictationSession, output: LogOutputChannel): Disposable[] {
  return [
    commands.registerCommand('copilotSpeech.startChatDictation', async () => {
      const configuration = workspace.getConfiguration('copilotSpeech')
      output.info('Start dictation requested.')
      try {
        await session.start(async () => ({
          language: normalizeLanguage(configuration.get('language', 'en')),
        }))
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
