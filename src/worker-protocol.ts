// Messages exchanged between the extension host (main thread) and the
// transcription worker thread. The worker owns the native capture helper,
// Silero VAD, and Cohere Transcribe inference; the main thread only sends
// control commands and renders the events below.

export interface WorkerData {
  /** Absolute path to the native capture helper executable. */
  helperPath: string
  /** Absolute path to the Silero VAD ONNX model shipped with `@ricky0123/vad-web`. */
  vadModelPath: string
  /** Hugging Face model id for the ASR pipeline. */
  modelId: string
  /** Quantization dtype passed to the pipeline (e.g. `q4f16`). */
  dtype: string
  /** Directory Transformers.js should use to cache model files. */
  cacheDir: string
}

export type WorkerCommand
  = | { type: 'start', sessionId: string, language: string }
    | { type: 'stop', sessionId: string }
    | { type: 'cancel', sessionId: string }

export type WorkerEvent
  = | { type: 'modelProgress', message: string }
    | { type: 'recording', sessionId: string }
    | { type: 'partial', sessionId: string, text: string }
    | { type: 'final', sessionId: string, text: string }
    | { type: 'cancelled', sessionId: string }
    | { type: 'error', code: string, message: string, sessionId?: string }
