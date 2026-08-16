import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { resolveUpstreamRoot } from './resolve-upstream.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstreamRoot = resolveUpstreamRoot()
const runtimeRoot = join(projectRoot, 'runtime')
const upstreamTsdownConfig = join(projectRoot, 'scripts', 'upstream-tsdown.config.mjs')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const targetPlatform = process.env.DSH_TARGET_PLATFORM ?? process.platform
const targetArch = process.env.DSH_TARGET_ARCH ?? process.arch

if (!['darwin', 'linux', 'win32'].includes(targetPlatform)) {
  throw new Error(`unsupported desktop target platform: ${targetPlatform}`)
}
if (!['arm64', 'ia32', 'x64'].includes(targetArch)) {
  throw new Error(`unsupported desktop target architecture: ${targetArch}`)
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

function assertUpstream() {
  const manifestPath = join(upstreamRoot, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`DSH_REPO does not point to a deepseek-harness checkout: ${upstreamRoot}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-root') {
    throw new Error(`unexpected upstream package at ${upstreamRoot}`)
  }
}

function workspacePackageDirs() {
  const packageDirs = []
  for (const entry of readdirSync(join(upstreamRoot, 'vendor'), { withFileTypes: true })) {
    if (entry.isDirectory()) packageDirs.push(join(upstreamRoot, 'vendor', entry.name))
  }
  for (const group of readdirSync(join(upstreamRoot, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const entry of readdirSync(join(upstreamRoot, 'packages', group.name), { withFileTypes: true })) {
      if (entry.isDirectory()) packageDirs.push(join(upstreamRoot, 'packages', group.name, entry.name))
    }
  }
  packageDirs.push(join(upstreamRoot, 'apps', 'cli'))
  return packageDirs.filter(dir => existsSync(join(dir, 'package.json')))
}

function workspaceFilterArgs() {
  return workspacePackageDirs().flatMap(dir => {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return typeof manifest.name === 'string' ? ['--filter', manifest.name] : []
  })
}

function workspaceFilterBatches(filters) {
  if (process.platform !== 'win32') return [filters]

  const maxCommandLength = 6000
  const batches = []
  let batch = []
  let length = 0
  for (let index = 0; index < filters.length; index += 2) {
    const pair = filters.slice(index, index + 2)
    const pairLength = pair.reduce((total, argument) => total + argument.length + 1, 0)
    if (batch.length > 0 && length + pairLength > maxCommandLength) {
      batches.push(batch)
      batch = []
      length = 0
    }
    batch.push(...pair)
    length += pairLength
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

assertUpstream()
console.log(`desktop: building upstream ${upstreamRoot}`)
// Keep optional native packages for every target platform because one runtime
// tree is reused to produce the macOS, Windows, and Linux installers.
run(pnpm, ['install', '--frozen-lockfile', '--force'], upstreamRoot)
const buildEnvironment = { ...process.env, DSH_REPO: upstreamRoot }
const filters = workspaceFilterArgs()
const filterBatches = workspaceFilterBatches(filters)

function buildTsdown(face) {
  for (const batch of filterBatches) {
    run(pnpm, [
      'exec',
      'tsdown',
      '--config',
      upstreamTsdownConfig,
      '--config-loader',
      'native',
      '--env.DSH_BUILD_FACE',
      face,
      ...batch,
    ], upstreamRoot, { ...buildEnvironment, DSH_BUILD_FACE: face })
  }
}

run(pnpm, ['exec', 'tsc', '-b', 'tsconfig.host.json'], upstreamRoot)
buildTsdown('host')
run(pnpm, ['exec', 'tsc', '-b', 'tsconfig.client.json'], upstreamRoot)
buildTsdown('client')
run(pnpm, ['--filter', '@deepseek-ai/dsh-web-frontend', 'run', 'build'], upstreamRoot)

rmSync(runtimeRoot, { recursive: true, force: true })
mkdirSync(runtimeRoot, { recursive: true })
run(pnpm, ['--filter', '@deepseek-ai/dsh', 'deploy', '--prod', '--legacy', '--force', runtimeRoot], upstreamRoot)

// dsh-app-boot imports this peer at runtime, but the current CLI manifest only
// reaches it through the workspace's dev dependency graph. Keep the deployed
// runtime independent of the source workspace by copying its built package.
const groupSource = join(upstreamRoot, 'vendor', 'group')
const groupTarget = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cordis-plugin-group')
mkdirSync(dirname(groupTarget), { recursive: true })
cpSync(groupSource, groupTarget, { recursive: true, dereference: true })

function copyWorkspacePackages() {
  for (const source of workspacePackageDirs()) {
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    if (typeof manifest.name !== 'string') continue
    const target = join(runtimeRoot, 'node_modules', ...manifest.name.split('/'))
    if (existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, {
      recursive: true,
      dereference: true,
      filter: path => {
        const relativePath = relative(source, path)
        if (relativePath === '') return true
        const firstSegment = relativePath.split(sep)[0]
        return !['.git', 'node_modules', 'src', 'test', 'tests', '__tests__'].includes(firstSegment)
      },
    })
  }
}

copyWorkspacePackages()

function linkRuntimeDependencies() {
  const sourceRoot = join(runtimeRoot, 'node_modules', '.pnpm', 'node_modules')
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const source = join(sourceRoot, entry.name)
    if (entry.name.startsWith('@')) {
      const targetScope = join(runtimeRoot, 'node_modules', entry.name)
      mkdirSync(targetScope, { recursive: true })
      for (const packageEntry of readdirSync(source, { withFileTypes: true })) {
        const target = join(targetScope, packageEntry.name)
        if (!existsSync(target)) symlinkSync(join(source, packageEntry.name), target)
      }
    } else {
      const target = join(runtimeRoot, 'node_modules', entry.name)
      if (!existsSync(target)) symlinkSync(source, target)
    }
  }
}

linkRuntimeDependencies()

function copyMaterializedTree(source, target) {
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter: path => {
      const relativePath = relative(source, path)
      if (relativePath === '') return true
      if (path.endsWith('.pdb')) return false
      return relativePath.split(sep)[0] !== 'node_modules'
    },
  })
}

function copyFlatNodeModules(sourceRoot, targetRoot) {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const source = join(sourceRoot, entry.name)
    if (entry.name.startsWith('@')) {
      const targetScope = join(targetRoot, entry.name)
      mkdirSync(targetScope, { recursive: true })
      for (const packageEntry of readdirSync(source, { withFileTypes: true })) {
        const target = join(targetScope, packageEntry.name)
        if (!existsSync(target)) copyMaterializedTree(join(source, packageEntry.name), target)
      }
    } else {
      const target = join(targetRoot, entry.name)
      if (!existsSync(target)) copyMaterializedTree(source, target)
    }
  }
}

function materializeRuntime() {
  const stagingRoot = `${runtimeRoot}.staging`
  rmSync(stagingRoot, { recursive: true, force: true })
  mkdirSync(stagingRoot, { recursive: true })
  for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (entry.name !== 'node_modules') copyMaterializedTree(join(runtimeRoot, entry.name), join(stagingRoot, entry.name))
  }
  const stagingModules = join(stagingRoot, 'node_modules')
  mkdirSync(stagingModules, { recursive: true })
  copyFlatNodeModules(join(runtimeRoot, 'node_modules'), stagingModules)
  copyFlatNodeModules(join(runtimeRoot, 'node_modules', '.pnpm', 'node_modules'), stagingModules)
  rmSync(runtimeRoot, { recursive: true, force: true })
  renameSync(stagingRoot, runtimeRoot)
}

materializeRuntime()

function platformVariant(name) {
  const match = name.match(/(?:^|-)(darwin|linuxmusl|linux|win32|freebsd|openbsd|android)(?:[-_](arm64|arm|ia32|x64|x86_64|riscv64|s390x|ppc64|loong64|wasm32))?(?:$|-)/)
  if (match === null) return undefined
  const arch = match[2] === 'x86_64' ? 'x64' : match[2]
  return { platform: match[1] === 'linuxmusl' ? 'linuxmusl' : match[1], arch }
}

function isTargetVariant(variant) {
  if (variant === undefined) return true
  if (variant.platform !== targetPlatform) return false
  return variant.arch === undefined || variant.arch === targetArch
}

function pruneOptionalPlatformPackages() {
  const modulesRoot = join(runtimeRoot, 'node_modules')
  for (const scopeEntry of readdirSync(modulesRoot, { withFileTypes: true })) {
    const scopeRoot = scopeEntry.name.startsWith('@')
      ? join(modulesRoot, scopeEntry.name)
      : modulesRoot
    const packageEntries = scopeEntry.name.startsWith('@')
      ? readdirSync(scopeRoot, { withFileTypes: true })
      : [scopeEntry]
    for (const packageEntry of packageEntries) {
      if (!packageEntry.isDirectory()) continue
      const packageRoot = join(scopeRoot, packageEntry.name)
      const manifestPath = join(packageRoot, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const variant = typeof manifest.name === 'string' ? platformVariant(manifest.name) : undefined
      if (variant !== undefined && !isTargetVariant(variant)) rmSync(packageRoot, { recursive: true, force: true })
    }
  }

  const nodePtyRoot = join(modulesRoot, 'node-pty')
  const prebuildsRoot = join(nodePtyRoot, 'prebuilds')
  if (existsSync(prebuildsRoot)) {
    for (const entry of readdirSync(prebuildsRoot, { withFileTypes: true })) {
      const variant = platformVariant(entry.name)
      if (variant !== undefined && !isTargetVariant(variant)) rmSync(join(prebuildsRoot, entry.name), { recursive: true, force: true })
    }
  }

  const conptyRoot = join(nodePtyRoot, 'third_party', 'conpty')
  if (existsSync(conptyRoot)) {
    if (targetPlatform !== 'win32') {
      rmSync(conptyRoot, { recursive: true, force: true })
    } else {
      for (const version of readdirSync(conptyRoot, { withFileTypes: true })) {
        if (!version.isDirectory()) continue
        for (const entry of readdirSync(join(conptyRoot, version.name), { withFileTypes: true })) {
          if (entry.name.startsWith('win10-') && entry.name.slice('win10-'.length) !== targetArch) {
            rmSync(join(conptyRoot, version.name, entry.name), { recursive: true, force: true })
          }
        }
      }
    }
  }
}

pruneOptionalPlatformPackages()
console.log(`desktop: packaged runtime target ${targetPlatform}-${targetArch}`)

const runtimeEntry = `import { lstat, mkdir, readFile, readdir, readlink, symlink, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runtimeRoot = dirname(fileURLToPath(import.meta.url))

async function linkRuntimeModule(source, target) {
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      if (await readlink(target) === source) return
      await unlink(target)
    } else {
      return
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
}

async function exposeRuntimeModules(dshHome) {
  const targetRoot = join(dshHome, 'profiles', 'node_modules')
  await mkdir(targetRoot, { recursive: true })
  const sourceRoot = join(runtimeRoot, 'node_modules')
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const source = join(sourceRoot, entry.name)
    if (entry.name.startsWith('@')) {
      const targetScope = join(targetRoot, entry.name)
      await mkdir(targetScope, { recursive: true })
      for (const packageEntry of await readdir(source, { withFileTypes: true })) {
        await linkRuntimeModule(join(source, packageEntry.name), join(targetScope, packageEntry.name))
      }
    } else {
      await linkRuntimeModule(source, join(targetRoot, entry.name))
    }
  }
}

async function loadProfileBoot() {
  const libDir = join(runtimeRoot, 'lib')
  const names = (await readdir(libDir)).filter(name => /^profile-boot-[^/]+\\.js$/.test(name))
  for (const name of names) {
    const filename = join(libDir, name)
    const source = await readFile(filename, 'utf8')
    if (source.includes('export { runProfile }')) {
      return import(pathToFileURL(filename).href)
    }
  }
  throw new Error('desktop: the deployed dsh CLI has no profile boot entry')
}

export async function startDshWeb({ dshHome, cwd }) {
  process.env.DSH_HOME = dshHome
  await exposeRuntimeModules(dshHome)
  const { loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot')
  const { runProfile } = await loadProfileBoot()
  const environment = loadLayeredEnv('dsh', cwd)
  const result = await runProfile({
    environment,
    profile: 'web',
    patchFiles: [],
    args: ['--host', '127.0.0.1', '--port', '0'],
  })
  const webServer = result.ctx.get('webServer')
  if (webServer === undefined) {
    await result.shutdown.shutdown(1)
    throw new Error('desktop: dsh web booted without a webServer service')
  }
  return {
    url: 'http://127.0.0.1:' + String(webServer.port),
    stop: () => result.shutdown.shutdown(0),
  }
}
`

writeFileSync(join(runtimeRoot, 'entry.mjs'), runtimeEntry)
cpSync(join(projectRoot, 'scripts', 'runtime-worker.mjs'), join(runtimeRoot, 'worker.mjs'))
console.log(`desktop: prepared runtime at ${runtimeRoot}`)
