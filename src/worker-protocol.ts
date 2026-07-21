export interface WorkerData {
  helperPath: string
  vadModelPath: string
  modelId: string
  dtype: string
  cacheDir: string
}

export type WorkerCommand
  = | { type: 'start', sessionId: string, language: string }
    | { type: 'stop', sessionId: string }
    | { type: 'cancel', sessionId: string }
    | { type: 'unloadModel' }

export type WorkerEvent
  = | { type: 'modelProgress', message: string, file?: string, loaded?: number, total?: number, level?: 'info' | 'debug' }
    | { type: 'recording', sessionId: string }
    | { type: 'partial', sessionId: string, text: string }
    | { type: 'final', sessionId: string, text: string }
    | { type: 'cancelled', sessionId: string }
    | { type: 'error', code: string, message: string, sessionId?: string }
