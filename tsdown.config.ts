import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { defineConfig } from 'tsdown'

const require = createRequire(import.meta.url)
const outDir = 'dist/extension'
const external = ['vscode', 'onnxruntime-node']

const vadDir = dirname(require.resolve('@ricky0123/vad-web/package.json'))
const silero = join(vadDir, 'dist/silero_vad_legacy.onnx')
// vad-web bundles onnxruntime-web, which dynamically imports these next to the worker chunk.
const ortWebDist = dirname(createRequire(join(vadDir, 'dist/index.js')).resolve('onnxruntime-web'))
const ortWasm = [
  join(ortWebDist, 'ort-wasm-simd-threaded.mjs'),
  join(ortWebDist, 'ort-wasm-simd-threaded.wasm'),
]

function rmExcept(dir: string, keep: string): void {
  for (const name of readdirSync(dir)) {
    if (name !== keep)
      rmSync(join(dir, name), { recursive: true, force: true })
  }
}

/** Copy host ONNX Runtime next to the worker (native addon, not bundlable). */
function vendorOnnx(): void {
  const dest = join(outDir, 'node_modules')
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })

  // pnpm: onnxruntime-common sits beside onnxruntime-node
  const ort = dirname(require.resolve('onnxruntime-node/package.json'))
  for (const name of ['onnxruntime-node', 'onnxruntime-common'])
    cpSync(join(dirname(ort), name), join(dest, name), { recursive: true, dereference: true })

  // This host only; drop optional GPU EPs
  const bin = join(dest, 'onnxruntime-node/bin/napi-v6')
  rmExcept(bin, process.platform)
  rmExcept(join(bin, process.platform), process.arch)
  for (const file of readdirSync(join(bin, process.platform, process.arch))) {
    if (/cuda|tensorrt|DirectML|dxcompiler|dxil/i.test(file))
      rmSync(join(bin, process.platform, process.arch, file), { force: true })
  }
}

export default defineConfig({
  entry: ['src/index.ts', 'src/transcription-worker.ts'],
  outDir,
  format: ['cjs'],
  dts: false,
  copy: [{ from: silero }, ...ortWasm.map(from => ({ from }))],
  deps: {
    neverBundle: external,
    alwaysBundle: id => !external.includes(id) && !id.startsWith('node:'),
  },
  plugins: [
    {
      // Transformers.js loads sharp for image pipelines; speech never needs it.
      name: 'stub-sharp',
      resolveId: (id: string) => id === 'sharp' ? '\0sharp' : null,
      load: (id: string) => id === '\0sharp' ? 'export default {}' : null,
    },
    { name: 'vendor-onnx', closeBundle: vendorOnnx },
  ],
})
