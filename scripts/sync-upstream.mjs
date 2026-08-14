import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstreamRoot = resolve(process.env.DSH_REPO ?? join(projectRoot, '..', 'deepseek-harness'))
const manifestPath = join(upstreamRoot, 'package.json')
if (!existsSync(manifestPath) || JSON.parse(readFileSync(manifestPath, 'utf8')).name !== '@deepseek-ai/dsh-root') {
  throw new Error(`DSH_REPO does not point to a deepseek-harness checkout: ${upstreamRoot}`)
}

const result = spawnSync('git', ['-C', upstreamRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
if (result.status !== 0) throw new Error(result.stderr?.trim() || 'cannot read upstream git revision')
console.log(`desktop: upstream ${upstreamRoot} at ${result.stdout.trim()}`)
console.log('desktop: run `pnpm run build` to rebuild the packaged runtime from this checkout')
