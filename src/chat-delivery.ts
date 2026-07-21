import { commands, env, window } from 'vscode'

const OPEN_CHAT_COMMAND = 'workbench.action.chat.open'
const FOCUS_CHAT_INPUT_COMMAND = 'workbench.action.chat.focusInput'

/**
 * Appends dictation as a tracked suffix. Never replaces the whole chat input
 * (chat.open({ query }) wipes manual + prior spoken text). Chat is not a normal
 * TextEditor, so we only rewrite the suffix this session typed.
 */
export class ChatDelivery {
  /** Last suffix we typed this session (includes any leading space). */
  private typed: string | undefined
  private live = true
  /** True after we have written any text (helps spacing when input is unreadable). */
  private mayHaveContent = false

  async showPreview(text: string): Promise<void> {
    const transcript = text.trim()
    if (!transcript || !this.live)
      return
    if (!(await this.writeSuffix(transcript)))
      this.live = false
  }

  async commit(text: string): Promise<void> {
    const transcript = text.trim()
    if (!transcript) {
      await this.clearPreview()
      return
    }

    if (this.live && this.typed !== undefined) {
      if (await this.writeSuffix(transcript)) {
        this.endSessionKeepText()
        return
      }
      this.live = false
    }

    await this.clearPreview()
    if (await appendOnly(transcript, this.mayHaveContent))
      this.mayHaveContent = true
    this.endSessionKeepText()
  }

  async clearPreview(): Promise<void> {
    if (this.typed === undefined) {
      this.live = true
      return
    }
    if (await focusChat())
      await deleteChars(this.typed.length)
    this.typed = undefined
    this.live = true
  }

  private async writeSuffix(transcript: string): Promise<boolean> {
    const piece = this.composePiece(transcript)
    if (piece === this.typed)
      return true

    if (!(await focusChat()))
      return false

    if (this.typed !== undefined && piece.startsWith(this.typed)) {
      await commands.executeCommand('type', { text: piece.slice(this.typed.length) })
      this.typed = piece
      this.mayHaveContent = true
      return true
    }

    if (this.typed !== undefined)
      await deleteChars(this.typed.length)
    else
      await commands.executeCommand('cursorBottom')

    await commands.executeCommand('type', { text: piece })
    this.typed = piece
    this.mayHaveContent = true
    return true
  }

  private composePiece(transcript: string): string {
    if (this.typed !== undefined) {
      const lead = this.typed.startsWith(' ') ? ' ' : ''
      return `${lead}${transcript}`
    }

    // Chat input is not a normal TextEditor, so activeTextEditor is usually a
    // code file (often ending in "\n"). Trust our own write tracking first —
    // otherwise subsequent takes glue onto the previous one ("tellingWork").
    return spacingForAppend(readChatContent(), transcript, this.mayHaveContent)
  }

  private endSessionKeepText(): void {
    this.typed = undefined
    this.live = true
  }
}

export async function deliverToChat(transcript: string): Promise<void> {
  await new ChatDelivery().commit(transcript)
}

async function appendOnly(transcript: string, mayHaveContent = false): Promise<boolean> {
  const text = transcript.trim()
  if (!text)
    return false

  if (await focusChat()) {
    await commands.executeCommand('cursorBottom')
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
  return true
}

async function deleteChars(count: number): Promise<void> {
  if (count <= 0)
    return
  await commands.executeCommand('cursorMove', { to: 'left', by: 'character', value: count, select: true })
  await commands.executeCommand('deleteLeft')
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
