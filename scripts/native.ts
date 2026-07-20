import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const action = process.argv[2]
const target = `${process.platform}-${process.arch}`
const buildDirectory = `dist/native/build/${target}`

function main(): void {
  if (action === 'configure') {
    // The capture-only helper depends only on header-only libraries fetched by
    // CMake (nlohmann/json + miniaudio). There is no ONNX runtime or speech
    // model to download, so configure is a plain CMake invocation.
    run('cmake', [
      '-S',
      'src/native',
      '-B',
      buildDirectory,
      '-DCMAKE_BUILD_TYPE=Release',
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
      '--test-dir',
      buildDirectory,
      '--build-config',
      'Release',
      '--output-on-failure',
    ])
    return
  }
  throw new Error(`Unknown native action: ${action ?? '<missing>'}`)
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root })
  if (result.error)
    throw result.error
  if ((result.status ?? 1) !== 0)
    process.exitCode = result.status ?? 1
}

main()
