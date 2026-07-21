import type { ExtensionContext } from 'vscode'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteDownloadedModel, DownloadProgressTracker, EXPECTED_MODEL_BYTES, modelIsCached } from '../src/model-download'

const MODEL_ID = 'onnx-community/cohere-transcribe-03-2026-ONNX'
const DTYPE = 'q4f16'

describe('modelIsCached', () => {
  let cacheDir: string

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'copilot-speech-cache-'))
  })

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
  })

  function onnxDir(): string {
    const dir = join(cacheDir, MODEL_ID, 'onnx')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  it('returns false when nothing is downloaded', () => {
    expect(modelIsCached(cacheDir, MODEL_ID, DTYPE)).toBe(false)
  })

  it('returns false when only partial temp data exists', () => {
    const dir = onnxDir()
    writeFileSync(join(dir, `encoder_model_${DTYPE}.onnx_data.tmp.123.abc`), 'x')
    expect(modelIsCached(cacheDir, MODEL_ID, DTYPE)).toBe(false)
  })

  it('returns true when both external-data files exist', () => {
    const dir = onnxDir()
    writeFileSync(join(dir, `encoder_model_${DTYPE}.onnx_data`), 'x')
    writeFileSync(join(dir, `decoder_model_merged_${DTYPE}.onnx_data`), 'x')
    expect(modelIsCached(cacheDir, MODEL_ID, DTYPE)).toBe(true)
  })

  it('returns false when only the encoder data exists', () => {
    const dir = onnxDir()
    writeFileSync(join(dir, `encoder_model_${DTYPE}.onnx_data`), 'x')
    expect(modelIsCached(cacheDir, MODEL_ID, DTYPE)).toBe(false)
  })
})

describe('deleteDownloadedModel', () => {
  let cacheDir: string

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'copilot-speech-cache-'))
  })

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
  })

  function fakeContext(): { context: ExtensionContext, update: ReturnType<typeof vi.fn> } {
    const update = vi.fn(async (_key: string, _value: unknown) => {})
    const context = { globalState: { update } } as unknown as ExtensionContext
    return { context, update }
  }

  it('removes the model directory and clears consent', () => {
    const dir = join(cacheDir, MODEL_ID, 'onnx')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `encoder_model_${DTYPE}.onnx_data`), 'x')
    writeFileSync(join(dir, `decoder_model_merged_${DTYPE}.onnx_data`), 'x')

    const { context, update } = fakeContext()
    const existed = deleteDownloadedModel(context, cacheDir, MODEL_ID)

    expect(existed).toBe(true)
    expect(existsSync(join(cacheDir, MODEL_ID))).toBe(false)
    expect(modelIsCached(cacheDir, MODEL_ID, DTYPE)).toBe(false)
    expect(update).toHaveBeenCalledWith('copilotSpeech.modelDownloadConsent', undefined)
  })

  it('returns false when there is nothing to delete', () => {
    const { context } = fakeContext()
    expect(deleteDownloadedModel(context, cacheDir, MODEL_ID)).toBe(false)
  })
})

describe('downloadProgressTracker', () => {
  const BIG = 300_000_000
  const SMALL_WEIGHT = 100_000_000
  const TINY = 2_000

  it('scales a single large file against the expected model size', () => {
    const tracker = new DownloadProgressTracker()
    const half = tracker.update('encoder.onnx_data', BIG / 2, BIG, undefined, 1_000)
    expect(half.percent).toBeGreaterThan(0)
    expect(half.percent).toBeLessThan(50)
    const one = tracker.update('encoder.onnx_data', BIG, BIG, undefined, 2_000)
    expect(one.percent).toBeLessThan(30)
  })

  it('reaches 100% only once all expected bytes have arrived', () => {
    const tracker = new DownloadProgressTracker()
    const done = tracker.update('all.onnx_data', EXPECTED_MODEL_BYTES, EXPECTED_MODEL_BYTES, undefined, 1_000)
    expect(done.percent).toBeCloseTo(100)
  })

  it('ignores tiny config files so they cannot jump the bar to 100%', () => {
    const tracker = new DownloadProgressTracker()
    const r = tracker.update('config.json', TINY, TINY, undefined, 1_000)
    expect(r.percent).toBe(0)
    expect(r.increment).toBe(0)
  })

  it('aggregates progress across multiple weight files by bytes', () => {
    const tracker = new DownloadProgressTracker()
    tracker.update('big', 0, BIG, undefined, 1_000)
    tracker.update('small', 0, SMALL_WEIGHT, undefined, 1_100)
    const r = tracker.update('big', BIG / 2, BIG, undefined, 2_000)
    tracker.update('small', SMALL_WEIGHT / 2, SMALL_WEIGHT, undefined, 2_100)
    expect(r.percent).toBeLessThan(50)
  })

  it('never emits a negative increment (monotonic bar)', () => {
    const tracker = new DownloadProgressTracker()
    const high = tracker.update('a', EXPECTED_MODEL_BYTES, EXPECTED_MODEL_BYTES, undefined, 1_000)
    expect(high.percent).toBeCloseTo(100)
    const r = tracker.update('b', 0, SMALL_WEIGHT, undefined, 2_000)
    expect(r.increment).toBe(0)
  })

  it('reports download speed in MB/s from successive samples', () => {
    const tracker = new DownloadProgressTracker()
    tracker.update('a', 0, BIG, undefined, 1_000)
    const first = tracker.update('a', 10 * 1024 * 1024, BIG, undefined, 2_000)
    expect(first.speedMBps).toBeCloseTo(10, 0)
    const second = tracker.update('a', 12 * 1024 * 1024, BIG, undefined, 3_000)
    expect(second.speedMBps).toBeGreaterThan(2)
    expect(second.speedMBps).toBeLessThan(10)
    expect(second.speedMBps).toBeCloseTo(0.3 * 2 + 0.7 * 10, 1)
  })

  it('ignores files without a known total', () => {
    const tracker = new DownloadProgressTracker()
    const r = tracker.update('a', undefined, undefined, 40, 1_000)
    expect(r.percent).toBe(0)
  })
})
