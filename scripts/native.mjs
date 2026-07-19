import { spawnSync } from 'node:child_process'
import process from 'node:process'

const action = process.argv[2]
const target = `${process.platform}-${process.arch}`
const buildDirectory = `dist/native/build/${target}`

const commands = {
  configure: ['cmake', ['-S', 'src/native', '-B', buildDirectory, '-DCMAKE_BUILD_TYPE=Release']],
  build: ['cmake', ['--build', buildDirectory, '--config', 'Release']],
  test: ['ctest', ['--test-dir', buildDirectory, '--build-config', 'Release', '--output-on-failure']],
}

const command = commands[action]
if (!command)
  throw new Error(`Unknown native action: ${action ?? '<missing>'}`)

const result = spawnSync(command[0], command[1], { stdio: 'inherit' })
if (result.error)
  throw result.error

process.exitCode = result.status ?? 1
