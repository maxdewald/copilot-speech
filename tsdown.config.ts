import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
  ],
  format: ['cjs'],
  shims: false,
  dts: false,
  deps: {
    neverBundle: ['vscode'],
    alwaysBundle: id => id !== 'vscode' && !id.startsWith('node:'),
    onlyBundle: false,
  },
})
