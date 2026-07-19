import { beforeEach, describe, expect, it } from 'vitest'
import { deliverToChat } from '../src/chat-delivery'
import { commands, env, resetVSCodeMock, window } from './support/vscode'

describe('chatTranscriptDelivery', () => {
  beforeEach(resetVSCodeMock)

  it('prefills Chat without submitting', async () => {
    commands.available = ['workbench.action.chat.open']

    await deliverToChat('Review this function')

    expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.chat.open', {
      query: 'Review this function',
      isPartialQuery: true,
    })
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('copies the transcript when Chat prefill is unavailable', async () => {
    await deliverToChat('Fallback transcript')

    expect(env.clipboard.writeText).toHaveBeenCalledWith('Fallback transcript')
    expect(window.showWarningMessage).toHaveBeenCalled()
  })
})
