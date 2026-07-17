// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    typescript: {
      tsconfigPath: 'tsconfig.json',
    },
    ignores: [
      '.vscode-test',
      'native/voice-helper/build',
    ],
  },
)
