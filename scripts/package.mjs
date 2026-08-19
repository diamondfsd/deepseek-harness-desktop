import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function run(command, commandArgs, env = process.env) {
  const result = spawnSync(command, commandArgs, {
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function targetFor(args) {
  if (args.includes('--win')) return { platform: 'win32', arch: args.includes('--arm64') ? 'arm64' : 'x64' }
  if (args.includes('--mac')) return { platform: 'darwin', arch: args.includes('--arm64') ? 'arm64' : process.arch }
  if (args.includes('--linux')) return { platform: 'linux', arch: args.includes('--arm64') ? 'arm64' : process.arch }
  return { platform: process.platform, arch: process.arch }
}

const target = targetFor(args)
const env = {
  ...process.env,
  DSH_TARGET_PLATFORM: target.platform,
  DSH_TARGET_ARCH: target.arch,
  DSH_SKIP_RUNTIME_ARCHIVE: 'true',
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
}

if (process.env.DSH_SKIP_ICON === 'true') {
  console.log('desktop: skipped icon generation')
} else {
  run(pnpm, ['run', 'generate:icon'], env)
}
run(pnpm, ['run', 'build'], env)
const builderArgs = ['exec', 'electron-builder']
if (process.env.DSH_BUILD_VERSION?.trim()) {
  builderArgs.push(`--config.extraMetadata.version=${process.env.DSH_BUILD_VERSION.trim()}`)
}
builderArgs.push(...args)
run(pnpm, builderArgs, env)
