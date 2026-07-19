import type { ExtensionContext } from 'vscode'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureModel } from '../src/model-download'
import { resetVSCodeMock, window } from './support/vscode'

describe('ensureModel', () => {
  beforeEach(resetVSCodeMock)

  it('does not download when the user declines', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const context = {
      globalStorageUri: { fsPath: '/missing/copilot-speech-test-storage' },
    } as ExtensionContext

    await expect(ensureModel(context, 'en', new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(window.withProgress).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the best available model architecture for each language', async () => {
    const context = { globalStorageUri: { fsPath: '/tmp' } } as ExtensionContext
    const signal = new AbortController().signal
    await expect(ensureModel(context, 'en', signal, '/models/en')).resolves.toEqual({ modelPath: '/models/en', modelArchitecture: 5 })
    await expect(ensureModel(context, 'es', signal, '/models/es')).resolves.toEqual({ modelPath: '/models/es', modelArchitecture: 1 })
    await expect(ensureModel(context, 'ko', signal, '/models/ko')).resolves.toEqual({ modelPath: '/models/ko', modelArchitecture: 0 })
  })
})
