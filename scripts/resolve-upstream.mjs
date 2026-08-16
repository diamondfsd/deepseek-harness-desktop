import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expectedPackageName = '@deepseek-ai/dsh-root'
const defaultRepoUrl = 'https://gitcode.com/gh_mirrors/de/deepseek-harness.git'
const defaultRepoRef = 'master'

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

function isUpstreamCheckout(root) {
  const manifestPath = join(root, 'package.json')
  if (!existsSync(manifestPath)) return false

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')).name === expectedPackageName
  } catch {
    return false
  }
}

function assertUpstream(root, source) {
  if (!isUpstreamCheckout(root)) {
    throw new Error(`${source} is not a deepseek-harness checkout: ${root}`)
  }
}

export function resolveUpstreamRoot() {
  const configuredRoot = process.env.DSH_REPO?.trim()
  if (configuredRoot) {
    const root = resolve(configuredRoot)
    assertUpstream(root, 'DSH_REPO')
    return root
  }

  const cacheRoot = resolve(
    process.env.DSH_REPO_CACHE?.trim() || join(homedir(), '.cache', 'deepseek-harness-desktop', 'deepseek-harness'),
  )
  const repoUrl = process.env.DSH_REPO_URL?.trim() || defaultRepoUrl
  const repoRef = process.env.DSH_REPO_REF?.trim() || defaultRepoRef

  const siblingRoot = resolve(projectRoot, '..', 'deepseek-harness')
  const hasExplicitCacheConfig = Boolean(
    process.env.DSH_REPO_CACHE?.trim() || process.env.DSH_REPO_URL?.trim() || process.env.DSH_REPO_REF?.trim(),
  )
  if (!hasExplicitCacheConfig && isUpstreamCheckout(siblingRoot)) return siblingRoot

  if (!existsSync(cacheRoot)) {
    mkdirSync(dirname(cacheRoot), { recursive: true })
    console.log(`desktop: cloning upstream ${repoUrl} (${repoRef})`)
    run('git', ['clone', '--depth', '1', '--branch', repoRef, repoUrl, cacheRoot])
  }

  assertUpstream(cacheRoot, 'automatic upstream cache')
  console.log(`desktop: using upstream cache ${cacheRoot}`)
  return cacheRoot
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(resolveUpstreamRoot())
}
