import { beforeEach, describe, expect, it } from 'vitest'
import { ChatDelivery, deliverToChat } from '../src/chat-delivery'
import { commands, env, getActiveTextEditorContent, resetVSCodeMock, setActiveTextEditorContent, window } from './support/vscode'

describe('chatTranscriptDelivery', () => {
  beforeEach(resetVSCodeMock)

  it('appends one-shot delivery without wiping existing text', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('Review this')

    await deliverToChat('function')

    expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.chat.open')
    expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.chat.focusInput')
    expect(commands.executeCommand).toHaveBeenCalledWith('cursorBottom')
    expect(commands.executeCommand).toHaveBeenCalledWith('type', { text: ' function' })
    expect(getActiveTextEditorContent()).toBe('Review this function')
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('inserts without a leading space when the field is empty', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('')

    await deliverToChat('Hello')

    expect(commands.executeCommand).toHaveBeenCalledWith('type', { text: 'Hello' })
    expect(getActiveTextEditorContent()).toBe('Hello')
  })

  it('skips the leading space when the field already ends with whitespace', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('Hello ')

    await deliverToChat('world')

    expect(commands.executeCommand).toHaveBeenCalledWith('type', { text: 'world' })
    expect(getActiveTextEditorContent()).toBe('Hello world')
  })

  it('uses bare transcript when the active editor cannot be read on first write', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent(undefined)

    await deliverToChat('world')

    expect(commands.executeCommand).toHaveBeenCalledWith('type', { text: 'world' })
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

  it('rewrites only the live suffix and preserves baseline text', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('Keep me')
    const delivery = new ChatDelivery()

    await delivery.showPreview('Hello')
    expect(getActiveTextEditorContent()).toBe('Keep me Hello')

    await delivery.showPreview('Hello world')
    expect(getActiveTextEditorContent()).toBe('Keep me Hello world')

    await delivery.commit('Hello from speech')
    expect(getActiveTextEditorContent()).toBe('Keep me Hello from speech')
  })

  it('appends a second recording after the first without overwriting', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('')
    const delivery = new ChatDelivery()

    await delivery.commit('First take')
    expect(getActiveTextEditorContent()).toBe('First take')

    await delivery.showPreview('Second')
    expect(getActiveTextEditorContent()).toBe('First take Second')

    await delivery.commit('Second take')
    expect(getActiveTextEditorContent()).toBe('First take Second take')
  })

  it('still spaces a later take when the active editor is a code buffer ending in a newline', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('')
    const delivery = new ChatDelivery()

    await delivery.commit('telling')
    // Chat is not a TextEditor; the focused buffer is often source that ends with "\n".
    setActiveTextEditorContent('function foo() {\n}\n')
    commands.executeCommand.mockClear()

    await delivery.commit('Work mate')
    expect(commands.executeCommand).toHaveBeenCalledWith('type', { text: ' Work mate' })
  })

  it('grows previews by typing only the delta when possible', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('')
    const delivery = new ChatDelivery()

    await delivery.showPreview('Hello')
    commands.executeCommand.mockClear()

    await delivery.showPreview('Hello world')
    expect(commands.executeCommand).toHaveBeenCalledWith('type', { text: ' world' })
    expect(commands.executeCommand).not.toHaveBeenCalledWith('cursorMove', expect.anything())
    expect(getActiveTextEditorContent()).toBe('Hello world')
  })

  it('skips unchanged previews', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('')
    const delivery = new ChatDelivery()

    await delivery.showPreview('Hello')
    const calls = commands.executeCommand.mock.calls.length
    await delivery.showPreview('Hello')
    expect(commands.executeCommand.mock.calls.length).toBe(calls)
  })

  it('clears only the live suffix on cancel', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('Keep me')
    const delivery = new ChatDelivery()

    await delivery.showPreview('temporary')
    expect(getActiveTextEditorContent()).toBe('Keep me temporary')

    await delivery.clearPreview()
    expect(getActiveTextEditorContent()).toBe('Keep me')
  })

  it('never calls chat.open with a full query replace', async () => {
    commands.available = ['workbench.action.chat.open', 'workbench.action.chat.focusInput']
    setActiveTextEditorContent('Existing')
    const delivery = new ChatDelivery()

    await delivery.showPreview('Hello')
    await delivery.commit('Hello final')

    for (const call of commands.executeCommand.mock.calls) {
      if (call[0] === 'workbench.action.chat.open')
        expect(call.length).toBe(1)
    }
  })
})
