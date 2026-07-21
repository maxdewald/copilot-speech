import { beforeEach, describe, expect, it } from 'vitest'
import { deliverToChat } from '../src/chat-delivery'
import { commands, env, resetVSCodeMock, setActiveTextEditorContent, window } from './support/vscode'

describe('chatTranscriptDelivery', () => {
  beforeEach(resetVSCodeMock)

  it('appends the transcript at the end of Chat without wiping existing text', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('Review this')

    await deliverToChat('function')

    expect(commands.executeCommand).toHaveBeenNthCalledWith(1, 'workbench.action.chat.open')
    expect(commands.executeCommand).toHaveBeenNthCalledWith(2, 'workbench.action.chat.focusInput')
    expect(commands.executeCommand).toHaveBeenNthCalledWith(3, 'cursorBottom')
    expect(commands.executeCommand).toHaveBeenNthCalledWith(4, 'type', { text: ' function' })
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('inserts without a leading space when the field is empty', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('')

    await deliverToChat('Hello')

    expect(commands.executeCommand).toHaveBeenCalledWith('type', { text: 'Hello' })
  })

  it('skips the leading space when the field already ends with whitespace', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('Hello ')

    await deliverToChat('world')

    expect(commands.executeCommand).toHaveBeenCalledWith('type', { text: 'world' })
  })

  it('prefers a leading space when the active editor cannot be read', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent(undefined)

    await deliverToChat('world')

    expect(commands.executeCommand).toHaveBeenCalledWith('type', { text: ' world' })
  })

  it('does nothing for empty transcripts', async () => {
    commands.available = ['workbench.action.chat.open']

    await deliverToChat('   ')

    expect(commands.executeCommand).not.toHaveBeenCalled()
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('copies the transcript when Chat prefill is unavailable', async () => {
    await deliverToChat('Fallback transcript')

    expect(env.clipboard.writeText).toHaveBeenCalledWith('Fallback transcript')
    expect(window.showWarningMessage).toHaveBeenCalled()
  })
})
