import { beforeEach, describe, expect, it } from 'vitest'
import { ChatTranscriptDelivery } from '../../src/delivery/chat'
import { commands, env, resetVSCodeMock, window } from '../support/vscode'

describe('chatTranscriptDelivery', () => {
  beforeEach(resetVSCodeMock)

  it('prefills Chat without submitting', async () => {
    commands.available = ['workbench.action.chat.open']

    await new ChatTranscriptDelivery().deliver('Review this function')

    expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.chat.open', {
      query: 'Review this function',
      isPartialQuery: true,
    })
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('copies the transcript when Chat prefill is unavailable', async () => {
    await new ChatTranscriptDelivery().deliver('Fallback transcript')

    expect(env.clipboard.writeText).toHaveBeenCalledWith('Fallback transcript')
    expect(window.showWarningMessage).toHaveBeenCalled()
  })
})
