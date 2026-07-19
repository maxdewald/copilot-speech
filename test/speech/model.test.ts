import type { ExtensionContext } from 'vscode'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureModel } from '../../src/model-download'
import { resetVSCodeMock, window } from '../support/vscode'

describe('ensureModel', () => {
  beforeEach(resetVSCodeMock)

  it('does not download when the user declines', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const context = {
      globalStorageUri: { fsPath: '/missing/copilot-speech-test-storage' },
    } as ExtensionContext

    await expect(ensureModel(context, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(window.withProgress).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
