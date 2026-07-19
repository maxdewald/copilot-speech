import type { Buffer } from 'node:buffer'
import type { ExtensionContext, Progress } from 'vscode'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ProgressLocation, window } from 'vscode'

const MODEL_ID = 'medium-streaming-en'
const MODEL_BASE_URL = 'https://download.moonshine.ai/model/medium-streaming-en/quantized'

const MODEL_FILES = [
  'adapter.ort',
  'cross_kv.ort',
  'decoder_kv.ort',
  'encoder.ort',
  'frontend.ort',
  'streaming_config.json',
  'tokenizer.bin',
  'decoder_kv_with_attention.ort',
] as const

export async function ensureModel(context: ExtensionContext, signal: AbortSignal): Promise<string> {
  const modelPath = join(context.globalStorageUri.fsPath, 'models', MODEL_ID)
  if (await isInstalled(modelPath))
    return modelPath

  const action = await window.showInformationMessage(
    'Copilot Speech needs to download the 429 MB Moonshine Medium model. Audio remains on this device.',
    'Download',
  )
  if (action !== 'Download')
    throw new DOMException('Model download was cancelled.', 'AbortError')

  await mkdir(modelPath, { recursive: true })
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: 'Downloading Copilot Speech model',
      cancellable: true,
    },
    async (progress, token) => {
      const controller = new AbortController()
      const abort = (): void => controller.abort()
      const parentAbort = (): void => controller.abort()
      signal.addEventListener('abort', parentAbort, { once: true })
      const cancellation = token.onCancellationRequested(abort)
      try {
        await downloadFiles(modelPath, progress, controller.signal)
        await writeFile(join(modelPath, '.complete'), 'complete')
      }
      finally {
        cancellation.dispose()
        signal.removeEventListener('abort', parentAbort)
      }
    },
  )
  return modelPath
}

async function isInstalled(modelPath: string): Promise<boolean> {
  try {
    return (await readFile(join(modelPath, '.complete'), 'utf8')) === 'complete'
  }
  catch {
    return false
  }
}

async function downloadFiles(modelPath: string, progress: Progress<{ increment?: number, message?: string }>, signal: AbortSignal): Promise<void> {
  for (const name of MODEL_FILES) {
    const destination = join(modelPath, name)
    const partial = `${destination}.part`
    await rm(partial, { force: true })
    const response = await fetch(`${MODEL_BASE_URL}/${name}`, { signal })
    if (!response.ok || response.body === null)
      throw new Error(`Model download failed for ${name}: HTTP ${response.status}`)

    let fileBytes = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        fileBytes += chunk.length
        progress.report({
          message: `${name}: ${Math.floor(fileBytes / 1024 / 1024)} MB`,
        })
        callback(null, chunk)
      },
    })

    try {
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial), { signal })
      await rename(partial, destination)
    }
    catch (error) {
      await rm(partial, { force: true })
      throw error
    }
  }
}
