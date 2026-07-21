import type { Disposable, ExtensionContext, LogOutputChannel, Progress } from 'vscode'
import type { SpeechEngine, SpeechEvent } from './worker-speech-engine'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ProgressLocation, window } from 'vscode'

const CONSENT_KEY = 'copilotSpeech.modelDownloadConsent'
const MODEL_SIZE_LABEL = '~1.5 GB'
export const EXPECTED_MODEL_BYTES = 1_536_000_000
const MIN_TRACKED_FILE_BYTES = 1_000_000
const SPEED_SAMPLE_SECONDS = 1
const SPEED_SMOOTHING = 0.3

export function modelIsCached(cacheDir: string, modelId: string, dtype: string): boolean {
  const onnxDir = join(cacheDir, modelId, 'onnx')
  return existsSync(join(onnxDir, `encoder_model_${dtype}.onnx_data`))
    && existsSync(join(onnxDir, `decoder_model_merged_${dtype}.onnx_data`))
}

export function deleteDownloadedModel(
  context: ExtensionContext,
  cacheDir: string,
  modelId: string,
): boolean {
  const modelDir = join(cacheDir, modelId)
  const existed = existsSync(modelDir)
  rmSync(modelDir, { recursive: true, force: true })
  void context.globalState.update(CONSENT_KEY, undefined)
  return existed
}

export async function ensureModelConsent(
  context: ExtensionContext,
  cacheDir: string,
  modelId: string,
  dtype: string,
): Promise<boolean> {
  if (modelIsCached(cacheDir, modelId, dtype))
    return true
  if (context.globalState.get<boolean>(CONSENT_KEY) === true)
    return true

  const proceed = 'Download'
  const choice = await window.showInformationMessage(
    `Copilot Speech needs to download the Cohere Transcribe speech model (${MODEL_SIZE_LABEL}). It runs entirely on your machine and is cached for future use.`,
    proceed,
    'Not Now',
  )
  if (choice !== proceed)
    return false

  await context.globalState.update(CONSENT_KEY, true)
  return true
}

export interface DownloadProgressUpdate {
  increment: number
  percent: number
  speedMBps: number
}

export class DownloadProgressTracker {
  private readonly files = new Map<string, { loaded: number, total: number }>()
  private reported = 0
  private lastSample: { at: number, loaded: number } | undefined
  private speedMBps = 0

  update(
    file: string,
    loaded: number | undefined,
    total: number | undefined,
    _filePercent?: number | undefined,
    now = Date.now(),
  ): DownloadProgressUpdate {
    if (total !== undefined && total >= MIN_TRACKED_FILE_BYTES) {
      this.files.set(file, {
        loaded: Math.min(Math.max(loaded ?? 0, 0), total),
        total,
      })
    }

    let sumLoaded = 0
    let sumTotal = 0
    for (const entry of this.files.values()) {
      sumLoaded += entry.loaded
      sumTotal += entry.total
    }

    const denominator = Math.max(sumTotal, EXPECTED_MODEL_BYTES)
    const percent = denominator > 0
      ? Math.min(100, (sumLoaded / denominator) * 100)
      : 0

    if (this.lastSample === undefined) {
      this.lastSample = { at: now, loaded: sumLoaded }
    }
    else {
      const dt = (now - this.lastSample.at) / 1000
      if (dt >= SPEED_SAMPLE_SECONDS) {
        const deltaBytes = sumLoaded - this.lastSample.loaded
        if (deltaBytes >= 0) {
          const instant = deltaBytes / (1024 * 1024) / dt
          this.speedMBps = this.speedMBps <= 0
            ? instant
            : SPEED_SMOOTHING * instant + (1 - SPEED_SMOOTHING) * this.speedMBps
        }
        this.lastSample = { at: now, loaded: sumLoaded }
      }
    }

    const increment = Math.max(0, percent - this.reported)
    this.reported = Math.max(this.reported, percent)
    return { increment, percent, speedMBps: this.speedMBps }
  }
}

export function registerModelProgressReporter(
  engine: SpeechEngine,
  output: LogOutputChannel,
  isModelCached: () => boolean,
): Disposable {
  let progress: Progress<{ message?: string, increment?: number }> | undefined
  let resolveProgress: (() => void) | undefined
  let tracker = new DownloadProgressTracker()

  const close = (): void => {
    resolveProgress?.()
    progress = undefined
    resolveProgress = undefined
  }

  const open = (): void => {
    if (progress || resolveProgress)
      return
    tracker = new DownloadProgressTracker()
    void window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `Downloading speech model (${MODEL_SIZE_LABEL})`,
        cancellable: false,
      },
      async (reporter) => {
        await new Promise<void>((resolve) => {
          progress = reporter
          resolveProgress = resolve
        })
      },
    )
  }

  return engine.onEvent((event: SpeechEvent) => {
    switch (event.type) {
      case 'modelProgress': {
        output.debug(`model progress: ${event.message}`)
        if (isModelCached())
          break
        open()
        if (event.file === undefined) {
          progress?.report({ message: event.message })
          break
        }
        const { increment, percent, speedMBps } = tracker.update(event.file, event.loaded, event.total)
        const speedLabel = speedMBps >= 0.05
          ? `${speedMBps.toFixed(1)} MB/s`
          : speedMBps > 0
            ? `${(speedMBps * 1024).toFixed(0)} KB/s`
            : '…'
        progress?.report({
          message: `${Math.floor(percent)}% · ${speedLabel}`,
          ...(increment > 0 ? { increment } : {}),
        })
        break
      }
      case 'recording':
      case 'error':
        close()
        break
      case 'partial':
      case 'final':
      case 'cancelled':
        break
    }
  })
}
