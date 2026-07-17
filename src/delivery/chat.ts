import { commands, env, window } from 'vscode'

const OPEN_CHAT_COMMAND = 'workbench.action.chat.open'

export interface TranscriptDelivery {
  deliver: (transcript: string) => Promise<void>
}

export class ChatTranscriptDelivery implements TranscriptDelivery {
  async deliver(transcript: string): Promise<void> {
    const availableCommands = await commands.getCommands(true)
    if (availableCommands.includes(OPEN_CHAT_COMMAND)) {
      await commands.executeCommand(OPEN_CHAT_COMMAND, {
        query: transcript,
        isPartialQuery: true,
      })
      return
    }

    await env.clipboard.writeText(transcript)
    const action = await window.showWarningMessage(
      'VS Code could not prefill Chat. The transcript was copied to the clipboard.',
      'Open Chat',
    )
    if (action === 'Open Chat')
      await commands.executeCommand(OPEN_CHAT_COMMAND)
  }
}
