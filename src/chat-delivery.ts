import { commands, env, window } from 'vscode'

const OPEN_CHAT_COMMAND = 'workbench.action.chat.open'
const FOCUS_CHAT_INPUT_COMMAND = 'workbench.action.chat.focusInput'

export async function deliverToChat(transcript: string): Promise<void> {
  const text = transcript.trim()
  if (!text)
    return

  const availableCommands = await commands.getCommands(true)
  if (availableCommands.includes(OPEN_CHAT_COMMAND)) {
    await commands.executeCommand(OPEN_CHAT_COMMAND)
    if (availableCommands.includes(FOCUS_CHAT_INPUT_COMMAND))
      await commands.executeCommand(FOCUS_CHAT_INPUT_COMMAND)
    await commands.executeCommand('cursorBottom')
    await commands.executeCommand('type', { text: appendText(text) })
    return
  }

  await env.clipboard.writeText(text)
  const action = await window.showWarningMessage(
    'VS Code could not prefill Chat. The transcript was copied to the clipboard.',
    'Open Chat',
  )
  if (action === 'Open Chat')
    await commands.executeCommand(OPEN_CHAT_COMMAND)
}

function appendText(transcript: string): string {
  const editor = window.activeTextEditor
  if (!editor)
    return ` ${transcript}`

  const content = editor.document.getText()
  if (content.length === 0 || content.trim().length === 0)
    return transcript
  if (/\s$/.test(content))
    return transcript
  return ` ${transcript}`
}
