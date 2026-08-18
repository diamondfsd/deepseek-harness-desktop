import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveUpstreamRoot } from './resolve-upstream.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstreamRoot = resolveUpstreamRoot()
const upstreamPackagePath = join(upstreamRoot, 'apps', 'cli', 'package.json')
const desktopPackagePath = join(projectRoot, 'package.json')

function readPackage(path, label) {
  let packageJson
  try {
    packageJson = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${label} package: ${path}`, { cause: error })
  }
  if (typeof packageJson.version !== 'string' || packageJson.version === '') {
    throw new Error(`${label} package has no version: ${path}`)
  }
  return packageJson
}

const upstreamPackage = readPackage(upstreamPackagePath, 'upstream CLI')
const desktopPackage = readPackage(desktopPackagePath, 'desktop')

if (desktopPackage.version === upstreamPackage.version) {
  console.log(`desktop: version already ${desktopPackage.version}`)
} else {
  desktopPackage.version = upstreamPackage.version
  writeFileSync(desktopPackagePath, `${JSON.stringify(desktopPackage, null, 2)}\n`)
  console.log(`desktop: version ${desktopPackage.version} -> ${upstreamPackage.version}`)
}

console.log(`desktop: synced from ${upstreamPackagePath}`)
