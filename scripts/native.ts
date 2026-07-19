import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { ensureNativeDeps } from './native-deps.ts'

const action = process.argv[2]
const target = `${process.platform}-${process.arch}`
const buildDirectory = `dist/native/build/${target}`

async function main() {
  if (action === 'configure') {
    const depsDir = await ensureNativeDeps(target)
    run('cmake', [
      '-S',
      'src/native',
      '-B',
      buildDirectory,
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

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error)
    throw result.error
  if ((result.status ?? 1) !== 0)
    process.exitCode = result.status ?? 1
}

await main()
