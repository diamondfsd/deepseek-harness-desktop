import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'assets', 'deepseek-harness-icon.svg')
const build = join(root, 'build')
const png = join(build, 'icon.png')
const iconset = join(build, 'icon.iconset')

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

mkdirSync(build, { recursive: true })
run('rsvg-convert', ['--width', '1024', '--height', '1024', '--output', png, source])

if (process.platform === 'darwin') {
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  for (const [name, size] of [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ]) {
    run('rsvg-convert', [
      '--width', String(size),
      '--height', String(size),
      '--output', join(iconset, name),
      source,
    ])
  }
  run('iconutil', ['--convert', 'icns', '--output', join(build, 'icon.icns'), iconset])
  rmSync(iconset, { recursive: true, force: true })
}

console.log(`desktop: generated ${png}`)
