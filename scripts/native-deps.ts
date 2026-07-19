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

interface RuntimeCopy {
  from: string
  to: string
}

interface Manifest {
  version: string
  target: string
  includeDir: string
  library: string
  onnxRuntime: string
  extraLinkLibs: string[]
  runtimeCopies: RuntimeCopy[]
}

interface PyPIFile {
  filename?: string
  url?: string
  digests?: {
    sha256?: string
  }
}

interface PyPIPackage {
  info?: {
    version?: string
  }
  urls?: PyPIFile[]
}

interface WheelPlatform {
  kind: 'wheel'
  needles: string[]
  library: string
  onnxGlob: (name: string) => boolean
  runtimeCopies: (library: string, onnxRuntime: string) => RuntimeCopy[]
}

interface ArchivePlatform {
  kind: 'archive'
}

type Platform = WheelPlatform | ArchivePlatform

export async function ensureNativeDeps(
  target = `${process.platform}-${process.arch}`,
): Promise<string> {
  const depsDir = join(root, 'dist/native/deps', target)
  const manifestPath = join(depsDir, 'manifest.json')

  const pypi = await fetchJson<PyPIPackage>('https://pypi.org/pypi/moonshine-voice/json')
  const version = pypi.info?.version
  if (version === undefined || version === '')
    throw new Error('Could not resolve latest moonshine-voice version from PyPI')

  if (manifestMatches(manifestPath, version, depsDir)) {
    console.log(`Using cached Moonshine Voice ${version} in ${relative(root, depsDir)}`)
    return depsDir
  }

  console.log(`Fetching Moonshine Voice ${version} for ${target}`)
  rmSync(depsDir, { recursive: true, force: true })
  mkdirSync(depsDir, { recursive: true })

  const moonshineDir = join(depsDir, 'moonshine')
  mkdirSync(moonshineDir, { recursive: true })

  const platform = resolvePlatform(target)
  let runtimeCopies: RuntimeCopy[]
  let extraLinkLibs: string[] = []
  let library: string
  let onnxRuntime: string
  let includeDir = join(depsDir, 'include')

  if (platform.kind === 'wheel') {
    const wheel = selectWheel(pypi.urls ?? [], platform.needles)
    const wheelPath = join(moonshineDir, 'moonshine.whl')
    await download(wheel.url, wheelPath, wheel.sha256)
    extractArchive(wheelPath, moonshineDir)

    library = join(moonshineDir, platform.library)
    const matchedOnnx = findFiles(moonshineDir, platform.onnxGlob).sort().at(-1)
    if (matchedOnnx === undefined)
      throw new Error(`No ONNX Runtime library found under ${moonshineDir}`)
    onnxRuntime = matchedOnnx
    runtimeCopies = platform.runtimeCopies(library, onnxRuntime)
  }
  else {
    const archiveUrl = `https://github.com/moonshine-ai/moonshine/releases/download/v${version}/moonshine-voice-windows-x86_64.tar.gz`
    const archivePath = join(moonshineDir, 'moonshine.tar.gz')
    await download(archiveUrl, archivePath)
    extractArchive(archivePath, moonshineDir)

    const windowsRoot = join(moonshineDir, 'moonshine-voice-windows-x86_64')
    includeDir = join(windowsRoot, 'include')
    library = join(windowsRoot, 'lib/moonshine.lib')
    onnxRuntime = join(windowsRoot, 'lib/onnxruntime.dll')
    extraLinkLibs = [
      join(windowsRoot, 'lib/moonshine-utils.lib'),
      join(windowsRoot, 'lib/ort-utils.lib'),
      join(windowsRoot, 'lib/bin-tokenizer.lib'),
      join(windowsRoot, 'lib/onnxruntime.lib'),
    ]
    runtimeCopies = [{ from: onnxRuntime, to: '.' }]
  }

  for (const path of [library, onnxRuntime, ...extraLinkLibs]) {
    if (!existsSync(path))
      throw new Error(`Expected native dependency missing: ${path}`)
  }

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

  // miniaudio + nlohmann/json are fetched by CMake (FetchContent) during configure.

  const manifest: Manifest = {
    version,
    target,
    includeDir,
    library,
    onnxRuntime,
    extraLinkLibs,
    runtimeCopies,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${relative(root, manifestPath)}`)
  return depsDir
}

function resolvePlatform(target: string): Platform {
  if (target === 'linux-x64') {
    return {
      kind: 'wheel',
      needles: ['manylinux', 'x86_64'],
      library: 'moonshine_voice/libmoonshine.so',
      onnxGlob: name => name.startsWith('libonnxruntime') && name.includes('.so'),
      runtimeCopies: (library, onnxRuntime) => [
        { from: library, to: 'moonshine_voice' },
        { from: onnxRuntime, to: 'moonshine_voice.libs' },
      ],
    }
  }
  if (target === 'darwin-arm64') {
    return {
      kind: 'wheel',
      needles: ['macosx', 'arm64'],
      library: 'moonshine_voice/libmoonshine.dylib',
      onnxGlob: name => name.startsWith('libonnxruntime') && name.endsWith('.dylib'),
      runtimeCopies: (library, onnxRuntime) => [
        { from: library, to: '.' },
        { from: onnxRuntime, to: '.' },
      ],
    }
  }
  if (target === 'win32-x64')
    return { kind: 'archive' }

  throw new Error(`Moonshine Voice is not configured for ${target} yet.`)
}

function selectWheel(urls: PyPIFile[], needles: string[]) {
  let best: { filename: string, url: string, sha256: string } | undefined
  for (const entry of urls) {
    const filename = entry.filename ?? ''
    if (!needles.every(needle => filename.includes(needle)))
      continue
    const url = entry.url
    const sha256 = entry.digests?.sha256
    if (url === undefined || url === '' || sha256 === undefined || sha256 === '')
      continue
    if (best === undefined || filename > best.filename) {
      best = {
        filename,
        url,
        sha256,
      }
    }
  }
  if (best === undefined)
    throw new Error(`No Moonshine Voice wheel found matching: ${needles.join(', ')}`)
  console.log(`Moonshine Voice wheel: ${best.filename}`)
  return best
}

function manifestMatches(manifestPath: string, version: string, depsDir: string): boolean {
  if (!existsSync(manifestPath))
    return false
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<Manifest>
    if (manifest.version !== version)
      return false
    const required = [
      manifest.library,
      manifest.onnxRuntime,
      ...(manifest.extraLinkLibs ?? []),
      join(manifest.includeDir ?? join(depsDir, 'include'), 'moonshine-cpp.h'),
    ]
    return required.every(path => typeof path === 'string' && existsSync(path))
  }
  catch {
    return false
  }
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

function findFiles(rootDir: string, predicate: (name: string) => boolean): string[] {
  const matches: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory())
        walk(full)
      else if (predicate(entry.name))
        matches.push(full)
    }
  }
  walk(rootDir)
  return matches
}
