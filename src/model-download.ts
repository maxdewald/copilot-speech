import type { Buffer } from 'node:buffer'
import type { ExtensionContext, Progress } from 'vscode'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ProgressLocation, window } from 'vscode'

export type SpeechLanguage = 'ar' | 'en' | 'es' | 'ja' | 'ko' | 'uk' | 'vi' | 'zh'
export type ModelArchitecture = 0 | 1 | 5

export interface ModelSelection {
  modelPath: string
  modelArchitecture: ModelArchitecture
}

const STREAMING_MODEL_FILES = [
  'adapter.ort',
  'cross_kv.ort',
  'decoder_kv.ort',
  'encoder.ort',
  'frontend.ort',
  'streaming_config.json',
  'tokenizer.bin',
  'decoder_kv_with_attention.ort',
] as const

const BASE_MODEL_FILES = [
  'encoder_model.ort',
  'decoder_model_merged.ort',
  'tokenizer.bin',
] as const

const MODELS: Record<SpeechLanguage, {
  id: string
  name: string
  architecture: ModelArchitecture
  baseUrl: string
  files: readonly string[]
}> = {
  ar: modelEntry('base-ar', 'Arabic'),
  en: {
    id: 'medium-streaming-en',
    name: 'English',
    architecture: 5,
    baseUrl: 'https://download.moonshine.ai/model/medium-streaming-en/quantized',
    files: STREAMING_MODEL_FILES,
  },
  es: modelEntry('base-es', 'Spanish'),
  ja: modelEntry('base-ja', 'Japanese'),
  ko: modelEntry('tiny-ko', 'Korean', 0),
  uk: modelEntry('base-uk', 'Ukrainian'),
  vi: modelEntry('base-vi', 'Vietnamese'),
  zh: modelEntry('base-zh', 'Chinese'),
}

export async function ensureModel(context: ExtensionContext, language: SpeechLanguage, signal: AbortSignal, modelPath = ''): Promise<ModelSelection> {
  const model = MODELS[language]
  if (modelPath)
    return { modelPath, modelArchitecture: model.architecture }

  const installedPath = join(context.globalStorageUri.fsPath, 'models', model.id)
  if (await isInstalled(installedPath))
    return { modelPath: installedPath, modelArchitecture: model.architecture }

  const action = await window.showInformationMessage(
    `Copilot Speech needs to download the local Moonshine ${model.name} model. Audio remains on this device.`,
    'Download',
  )
  if (action !== 'Download')
    throw new DOMException('Model download was cancelled.', 'AbortError')

  await mkdir(installedPath, { recursive: true })
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: 'Downloading Copilot Speech model',
      cancellable: true,
    },
    async (progress, token) => {
      const controller = new AbortController()
      const abort = (): void => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      const cancellation = token.onCancellationRequested(abort)
      try {
        await downloadFiles(model, installedPath, progress, controller.signal)
        await writeFile(join(installedPath, '.complete'), 'complete')
      }
      finally {
        cancellation.dispose()
        signal.removeEventListener('abort', abort)
      }
    },
  )
  return { modelPath: installedPath, modelArchitecture: model.architecture }
}

function modelEntry(id: string, name: string, architecture: ModelArchitecture = 1): typeof MODELS[SpeechLanguage] {
  return {
    id,
    name,
    architecture,
    baseUrl: `https://download.moonshine.ai/model/${id}/quantized/${id}`,
    files: BASE_MODEL_FILES,
  }
}

async function isInstalled(modelPath: string): Promise<boolean> {
  try {
    return (await readFile(join(modelPath, '.complete'), 'utf8')) === 'complete'
  }
  catch {
    return false
  }
}

async function downloadFiles(model: typeof MODELS[SpeechLanguage], modelPath: string, progress: Progress<{ increment?: number, message?: string }>, signal: AbortSignal): Promise<void> {
  for (const name of model.files) {
    const destination = join(modelPath, name)
    const partial = `${destination}.part`
    await rm(partial, { force: true })
    const response = await fetch(`${model.baseUrl}/${name}`, { signal })
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
