import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const action = process.argv[2]
const target = `${process.platform}-${process.arch}`
const buildDirectory = `dist/native/build/${target}`

interface PyPIFile {
  filename?: string
  url?: string
  digests?: { sha256?: string }
}

interface PyPIPackage {
  info?: { version?: string }
  urls?: PyPIFile[]
}

async function main() {
  if (action === 'configure') {
    const depsDir = await ensureNativeDeps(target)
    run('cmake', [
      '-S', 'src/native',
      '-B', buildDirectory,
      '-DCMAKE_BUILD_TYPE=Release',
      `-DCOPILOT_SPEECH_DEPS_DIR=${depsDir}`,
      `-DCOPILOT_SPEECH_RUNTIME_TARGET=${target}`,
    ])
    return
  }
  if (action === 'build') {
    run('cmake', ['--build', buildDirectory, '--config', 'Release'])
    return
  }
  if (action === 'test') {
    run('ctest', [
      '--test-dir', buildDirectory,
      '--build-config', 'Release',
      '--output-on-failure',
    ])
    return
  }
  throw new Error(`Unknown native action: ${action ?? '<missing>'}`)
}

async function ensureNativeDeps(target: string): Promise<string> {
  const depsDir = join(root, 'dist/native/deps', target)
  const pypi = await fetchJson<PyPIPackage>('https://pypi.org/pypi/moonshine-voice/json')
  const version = pypi.info?.version
  if (!version)
    throw new Error('Could not resolve latest moonshine-voice version from PyPI')

  if (isCached(depsDir, target, version)) {
    console.log(`Using cached Moonshine Voice ${version} in ${relative(root, depsDir)}`)
    return depsDir
  }

  console.log(`Fetching Moonshine Voice ${version} for ${target}`)
  rmSync(depsDir, { recursive: true, force: true })
  mkdirSync(depsDir, { recursive: true })
  const moonshineDir = join(depsDir, 'moonshine')
  mkdirSync(moonshineDir, { recursive: true })

  let includeDir = join(depsDir, 'include')
  if (target === 'linux-x64' || target === 'darwin-arm64') {
    const needles = target === 'linux-x64' ? ['manylinux', 'x86_64'] : ['macosx', 'arm64']
    const wheel = selectWheel(pypi.urls ?? [], needles)
    const wheelPath = join(moonshineDir, 'moonshine.whl')
    await download(wheel.url, wheelPath, wheel.sha256)
    extractArchive(wheelPath, moonshineDir)
  }
  else if (target === 'win32-x64') {
    const archivePath = join(moonshineDir, 'moonshine.tar.gz')
    await download(
      `https://github.com/moonshine-ai/moonshine/releases/download/v${version}/moonshine-voice-windows-x86_64.tar.gz`,
      archivePath,
    )
    extractArchive(archivePath, moonshineDir)
    includeDir = join(moonshineDir, 'moonshine-voice-windows-x86_64/include')
  }
  else {
    throw new Error(`Moonshine Voice is not configured for ${target} yet.`)
  }

  // miniaudio + nlohmann/json are fetched by CMake (FetchContent) during configure.
  mkdirSync(includeDir, { recursive: true })
  for (const header of ['moonshine-c-api.h', 'moonshine-cpp.h']) {
    const dest = join(includeDir, header)
    if (!existsSync(dest)) {
      await download(
        `https://raw.githubusercontent.com/moonshine-ai/moonshine/v${version}/core/${header}`,
        dest,
      )
    }
  }

  const missing = requiredArtifacts(depsDir, target).filter(path => !existsSync(path))
  if (missing.length > 0)
    throw new Error(`Expected native dependency missing: ${missing.join(', ')}`)

  writeFileSync(join(depsDir, 'version'), `${version}\n`)
  console.log(`Cached Moonshine Voice ${version} in ${relative(root, depsDir)}`)
  return depsDir
}

function isCached(depsDir: string, target: string, version: string): boolean {
  try {
    if (readFileSync(join(depsDir, 'version'), 'utf8').trim() !== version)
      return false
    return requiredArtifacts(depsDir, target).every(existsSync)
  }
  catch {
    return false
  }
}

function requiredArtifacts(depsDir: string, target: string): string[] {
  const moonshineDir = join(depsDir, 'moonshine')
  if (target === 'linux-x64' || target === 'darwin-arm64') {
    const lib = target === 'linux-x64' ? 'libmoonshine.so' : 'libmoonshine.dylib'
    return [
      join(moonshineDir, 'moonshine_voice', lib),
      findOnnx(moonshineDir, target) ?? join(moonshineDir, 'missing-onnx'),
      join(depsDir, 'include/moonshine-cpp.h'),
    ]
  }
  if (target === 'win32-x64') {
    const root = join(moonshineDir, 'moonshine-voice-windows-x86_64')
    return [
      'lib/moonshine.lib',
      'lib/onnxruntime.dll',
      'lib/moonshine-utils.lib',
      'lib/ort-utils.lib',
      'lib/bin-tokenizer.lib',
      'lib/onnxruntime.lib',
      'include/moonshine-cpp.h',
    ].map(rel => join(root, rel))
  }
  throw new Error(`Moonshine Voice is not configured for ${target} yet.`)
}

function findOnnx(moonshineDir: string, target: string): string | undefined {
  const match = (name: string) =>
    name.startsWith('libonnxruntime')
    && (target === 'linux-x64' ? name.includes('.so') : name.endsWith('.dylib'))

  for (const dir of [
    join(moonshineDir, 'moonshine_voice.libs'),
    join(moonshineDir, 'moonshine_voice'),
    moonshineDir,
  ]) {
    if (!existsSync(dir))
      continue
    const name = readdirSync(dir).filter(match).sort().at(-1)
    if (name !== undefined)
      return join(dir, name)
  }
  return undefined
}

function selectWheel(urls: PyPIFile[], needles: string[]) {
  let best: { filename: string, url: string, sha256: string } | undefined
  for (const entry of urls) {
    const filename = entry.filename ?? ''
    if (!needles.every(needle => filename.includes(needle)))
      continue
    const url = entry.url
    const sha256 = entry.digests?.sha256
    if (!url || !sha256)
      continue
    if (best === undefined || filename > best.filename)
      best = { filename, url, sha256 }
  }
  if (best === undefined)
    throw new Error(`No Moonshine Voice wheel found matching: ${needles.join(', ')}`)
  console.log(`Moonshine Voice wheel: ${best.filename}`)
  return best
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  return await response.json() as T
}

async function download(url: string, dest: string, expectedSha256?: string): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true })
  if (existsSync(dest) && expectedSha256 !== undefined) {
    const existing = createHash('sha256').update(readFileSync(dest)).digest('hex')
    if (existing === expectedSha256)
      return
  }

  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (expectedSha256 !== undefined) {
    const actual = createHash('sha256').update(buffer).digest('hex')
    if (actual !== expectedSha256)
      throw new Error(`Hash mismatch for ${url}: expected ${expectedSha256}, got ${actual}`)
  }
  writeFileSync(dest, buffer)
}

function extractArchive(archivePath: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  const result = spawnSync('cmake', ['-E', 'tar', 'xf', archivePath], {
    cwd: destination,
    stdio: 'inherit',
  })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`Failed to extract ${archivePath}`)
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error)
    throw result.error
  if ((result.status ?? 1) !== 0)
    process.exitCode = result.status ?? 1
}

await main()
