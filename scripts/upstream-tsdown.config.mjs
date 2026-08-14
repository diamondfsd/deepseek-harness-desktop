import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const upstreamRoot = process.env.DSH_REPO
if (upstreamRoot === undefined) throw new Error('DSH_REPO is required')

const { defineConfig } = await import(pathToFileURL(join(upstreamRoot, 'node_modules/tsdown/dist/index.mjs')).href)
const { typertPlugin } = await import(pathToFileURL(join(upstreamRoot, 'packages/typert/generator/lib/types/tsdown-plugin.js')).href)
const client = process.env.DSH_BUILD_FACE === 'client'

export default defineConfig({
  cwd: upstreamRoot,
  workspace: ['vendor/*', 'packages/*/*', 'apps/cli'],
  entry: ['lib/types/{index,invariant,startup}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
})
