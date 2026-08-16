import { spawnSync } from 'node:child_process'
import { resolveUpstreamRoot } from './resolve-upstream.mjs'

const upstreamRoot = resolveUpstreamRoot()

const result = spawnSync('git', ['-C', upstreamRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
if (result.status !== 0) throw new Error(result.stderr?.trim() || 'cannot read upstream git revision')
console.log(`desktop: upstream ${upstreamRoot} at ${result.stdout.trim()}`)
console.log('desktop: run `pnpm run build` to rebuild the packaged runtime from this checkout')
