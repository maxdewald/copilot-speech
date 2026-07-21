import { defineConfig } from 'tsdown'

const external = [
  'vscode',
  '@huggingface/transformers',
  '@ricky0123/vad-web',
  'onnxruntime-node',
  'onnxruntime-web',
]

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/transcription-worker.ts',
  ],
  outDir: 'dist/extension',
  format: ['cjs'],
  shims: false,
  dts: false,
  deps: {
    neverBundle: external,
    alwaysBundle: id => !external.includes(id) && !id.startsWith('node:'),
    onlyBundle: false,
  },
})
