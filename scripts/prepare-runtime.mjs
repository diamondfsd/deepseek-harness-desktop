import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstreamRoot = resolve(process.env.DSH_REPO ?? join(projectRoot, '..', 'deepseek-harness'))
const runtimeRoot = join(projectRoot, 'runtime')
const upstreamTsdownConfig = join(projectRoot, 'scripts', 'upstream-tsdown.config.mjs')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

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

assertUpstream()
console.log(`desktop: building upstream ${upstreamRoot}`)
// Keep optional native packages for every target platform because one runtime
// tree is reused to produce the macOS, Windows, and Linux installers.
run(pnpm, ['install', '--frozen-lockfile', '--force'], upstreamRoot)
const buildEnvironment = { ...process.env, DSH_REPO: upstreamRoot }
const filters = workspaceFilterArgs()
run(pnpm, ['exec', 'tsc', '-b', 'tsconfig.host.json'], upstreamRoot)
run(pnpm, [
  'exec',
  'tsdown',
  '--config',
  upstreamTsdownConfig,
  '--config-loader',
  'native',
  '--env.DSH_BUILD_FACE',
  'host',
  ...filters,
], upstreamRoot, { ...buildEnvironment, DSH_BUILD_FACE: 'host' })
run(pnpm, ['exec', 'tsc', '-b', 'tsconfig.client.json'], upstreamRoot)
run(pnpm, [
  'exec',
  'tsdown',
  '--config',
  upstreamTsdownConfig,
  '--config-loader',
  'native',
  '--env.DSH_BUILD_FACE',
  'client',
  ...filters,
], upstreamRoot, { ...buildEnvironment, DSH_BUILD_FACE: 'client' })
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
  await symlink(source, target)
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
