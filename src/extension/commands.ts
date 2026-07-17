import type { Disposable, LogOutputChannel, QuickPickItem } from 'vscode'
import type { HelperSupervisor } from '../speech/helper-supervisor'
import type { DictationSession } from '../speech/session'
import { commands, ConfigurationTarget, window, workspace } from 'vscode'

interface DeviceItem extends QuickPickItem {
  deviceId: string
}

export function registerCommands(
  session: DictationSession,
  helper: HelperSupervisor,
  output: LogOutputChannel,
): Disposable[] {
  return [
    commands.registerCommand('copilotSpeech.startChatDictation', async () => {
      const configuration = workspace.getConfiguration('copilotSpeech')
      try {
        await session.start({
          model: configuration.get('model', 'medium-streaming-en'),
          modelPath: configuration.get('modelPath', ''),
          deviceId: configuration.get('microphone', 'default'),
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
    commands.registerCommand('copilotSpeech.selectMicrophone', async () => {
      try {
        const devices = await helper.listDevices()
        const items = devices.map<DeviceItem>(device => device.isDefault
          ? { label: device.name, description: 'Default input', deviceId: device.id }
          : { label: device.name, deviceId: device.id })
        const selected = await window.showQuickPick<DeviceItem>(
          items,
          { placeHolder: 'Select the microphone used for local dictation' },
        )
        if (selected)
          await workspace.getConfiguration('copilotSpeech').update('microphone', selected.deviceId, ConfigurationTarget.Global)
      }
      catch (error) {
        void window.showErrorMessage(`Copilot Speech could not list microphones: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
    commands.registerCommand('copilotSpeech.showDiagnostics', () => {
      const configuration = workspace.getConfiguration('copilotSpeech')
      output.info(`State: ${session.state.state}`)
      output.info(`Helper configured: ${helper.configuredPath ? 'yes' : 'no'}`)
      output.info(`Model: ${configuration.get('model', 'medium-streaming-en')}`)
      output.info(`Model path configured: ${configuration.get('modelPath', '') ? 'yes' : 'no'}`)
      output.info(`Microphone: ${configuration.get('microphone', 'default')}`)
      output.show(true)
    }),
    commands.registerCommand('copilotSpeech.openSettings', () =>
      commands.executeCommand('workbench.action.openSettings', '@ext:maxdewald.copilot-speech')),
  ]
}
