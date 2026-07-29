import { commands, env, window } from 'vscode'

const OPEN_CHAT_COMMAND = 'workbench.action.chat.open'
const FOCUS_CHAT_INPUT_COMMAND = 'workbench.action.chat.focusInput'

export class ChatDelivery {
  private mayHaveContent = false

  async commit(text: string): Promise<void> {
    const transcript = text.trim()
    if (!transcript)
      return

    if (await appendOnly(transcript, this.mayHaveContent))
      this.mayHaveContent = true
  }
}

async function appendOnly(transcript: string, mayHaveContent = false): Promise<boolean> {
  const text = transcript.trim()
  if (!text)
    return false

  if (await focusChat()) {
    await commands.executeCommand('type', { text: spacingForAppend(readChatContent(), text, mayHaveContent) })
    return true
  }

  await env.clipboard.writeText(text)
  const action = await window.showWarningMessage(
    'VS Code could not prefill Chat. The transcript was copied to the clipboard.',
    'Open Chat',
  )
  if (action === 'Open Chat')
    await commands.executeCommand(OPEN_CHAT_COMMAND)
  return false
}

async function focusChat(): Promise<boolean> {
  const availableCommands = await commands.getCommands(true)
  if (!availableCommands.includes(OPEN_CHAT_COMMAND))
    return false
  await commands.executeCommand(OPEN_CHAT_COMMAND)
  if (availableCommands.includes(FOCUS_CHAT_INPUT_COMMAND))
    await commands.executeCommand(FOCUS_CHAT_INPUT_COMMAND)
  // The caret does not survive the async re-focus; anchor it at the end.
  await commands.executeCommand('cursorBottom')
  return true
}

function readChatContent(): string | undefined {
  return window.activeTextEditor?.document.getText()
}

function spacingForAppend(content: string | undefined, transcript: string, mayHaveContent: boolean): string {
  // Once we have typed anything this extension session, always separate the next
  // take. Do not trust activeTextEditor trailing whitespace — it is rarely the
  // chat input and code buffers almost always end with a newline.
  if (mayHaveContent)
    return ` ${transcript}`
  if (content === undefined || content.length === 0 || content.trim().length === 0)
    return transcript
  if (/\s$/.test(content))
    return transcript
  return ` ${transcript}`
}
