import { defineConfig } from 'tsdown'

// ML packages ship native binaries, ONNX models, and wasm assets that cannot be
// bundled into a single CJS file, so they stay external and ship in node_modules.
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
