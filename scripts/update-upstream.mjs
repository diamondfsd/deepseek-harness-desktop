import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstreamRoot = resolve(process.env.DSH_REPO ?? join(projectRoot, '..', 'deepseek-harness'))
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

run('git', ['pull', '--ff-only'], upstreamRoot)
run(pnpm, ['run', 'package'], projectRoot)
