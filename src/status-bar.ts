import type { StatusBarItem } from 'vscode'
import type { DictationSession, DictationSnapshot } from './dictation-session'
import { commands, StatusBarAlignment, ThemeColor, window } from 'vscode'

export function createStatusBar(session: DictationSession): StatusBarItem {
  const item = window.createStatusBarItem('copilotSpeech.status', StatusBarAlignment.Right, 90)
  item.name = 'Copilot Speech'

  const render = (snapshot: DictationSnapshot): void => {
    item.backgroundColor = undefined
    switch (snapshot.state) {
      case 'idle':
        item.text = '$(mic) Speech'
        item.tooltip = 'Start Copilot Speech dictation'
        item.command = 'copilotSpeech.startChatDictation'
        break
      case 'preparing':
        item.text = '$(loading~spin) Speech'
        item.tooltip = 'Preparing local speech recognition'
        item.command = 'copilotSpeech.cancelDictation'
        break
      case 'starting':
        item.text = '$(loading~spin) Speech'
        item.tooltip = 'Starting local speech recognition'
        item.command = 'copilotSpeech.cancelDictation'
        break
      case 'recording':
        item.text = '$(record) Listening'
        item.tooltip = 'Stop dictation and finish transcription in Copilot Chat'
        item.command = 'copilotSpeech.stopDictation'
        item.backgroundColor = new ThemeColor('statusBarItem.errorBackground')
        break
      case 'stopping':
      case 'delivering':
        item.text = '$(loading~spin) Finishing'
        item.tooltip = 'Finalizing local transcription'
        item.command = 'copilotSpeech.cancelDictation'
        break
      case 'cancelling':
        item.text = '$(loading~spin) Cancelling'
        item.tooltip = 'Discarding the current dictation'
        item.command = undefined
        break
      case 'error':
        item.text = '$(warning) Speech'
        item.tooltip = snapshot.error ?? 'Copilot Speech encountered an error'
        item.command = 'copilotSpeech.startChatDictation'
        item.backgroundColor = new ThemeColor('statusBarItem.warningBackground')
        break
    }
    item.accessibilityInformation = {
      label: `Copilot Speech: ${snapshot.state}`,
    }
    void commands.executeCommand('setContext', 'copilotSpeech.active', !['idle', 'error'].includes(snapshot.state))
    void commands.executeCommand('setContext', 'copilotSpeech.recording', snapshot.state === 'recording')
  }

  render(session.state)
  const subscription = session.onDidChangeState(render)
  const dispose = item.dispose.bind(item)
  item.dispose = () => {
    subscription.dispose()
    dispose()
  }
  return item
}
