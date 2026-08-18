import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { createGunzip } from 'node:zlib'
import { app } from 'electron'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

interface TarEntry {
  file?: Awaited<ReturnType<typeof open>>
  longName?: Buffer[]
  remaining: number
  padding: number
}

function tarNumber(header: Buffer, offset: number, length: number): number {
  const value = header.subarray(offset, offset + length).toString('ascii').replace(/\0/g, '').trim()
  return value === '' ? 0 : Number.parseInt(value, 8)
}

function tarName(header: Buffer): string {
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
  return prefix === '' ? name : `${prefix}/${name}`
}

function assertSafeEntry(root: string, name: string): string {
  if (isAbsolute(name) || name.split('/').some(part => part === '..')) {
    throw new Error(`desktop: unsafe runtime archive entry: ${name}`)
  }
  const target = resolve(root, name)
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`desktop: runtime archive entry escapes its target: ${name}`)
  }
  return target
}

async function extractRuntimeArchive(archivePath: string, targetRoot: string): Promise<void> {
  await mkdir(targetRoot, { recursive: true })
  let buffered = Buffer.alloc(0)
  let entry: TarEntry | undefined
  let pendingName: string | undefined

  for await (const chunk of createReadStream(archivePath).pipe(createGunzip())) {
    buffered = buffered.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffered, chunk])
    while (true) {
      if (entry === undefined) {
        if (buffered.length < 512) break
        const header = buffered.subarray(0, 512)
        buffered = buffered.subarray(512)
        const name = pendingName ?? tarName(header)
        pendingName = undefined
        if (name === '') break
        const size = tarNumber(header, 124, 12)
        const type = header[156]
        if (type === 0x4c) {
          entry = {
            longName: [],
            remaining: size,
            padding: (512 - (size % 512)) % 512,
          }
        } else if (type === 0x35) {
          const target = assertSafeEntry(targetRoot, name.replace(/\/$/, ''))
          await mkdir(target, { recursive: true })
        } else if (type === 0x30 || type === 0) {
          const target = assertSafeEntry(targetRoot, name.replace(/\/$/, ''))
          await mkdir(dirname(target), { recursive: true })
          entry = {
            file: await open(target, 'w'),
            remaining: size,
            padding: (512 - (size % 512)) % 512,
          }
        } else {
          throw new Error(`desktop: unsupported runtime archive entry: ${name}`)
        }
      }
      if (entry === undefined) continue
      if (entry.remaining > 0) {
        if (buffered.length === 0) break
        const size = Math.min(entry.remaining, buffered.length)
        const data = buffered.subarray(0, size)
        if (entry.longName === undefined) await entry.file?.write(data)
        else entry.longName.push(Buffer.from(data))
        buffered = buffered.subarray(size)
        entry.remaining -= size
        if (entry.remaining > 0) continue
      }
      if (entry.padding > 0) {
        const size = Math.min(entry.padding, buffered.length)
        buffered = buffered.subarray(size)
        entry.padding -= size
        if (entry.padding > 0) break
      }
      await entry.file?.close()
      if (entry.longName !== undefined) {
        pendingName = Buffer.concat(entry.longName).toString('utf8').replace(/\0.*$/, '')
      }
      entry = undefined
    }
  }

  if (entry !== undefined) {
    await entry.file?.close()
    throw new Error('desktop: runtime archive ended before all files were extracted')
  }
}

export async function ensureRuntimeRoot(): Promise<string> {
  if (!app.isPackaged) return join(app.getAppPath(), 'runtime')

  // New installers expand the runtime into resources during installation.
  // Keep the archive path below as a compatibility fallback for older builds.
  const packagedRuntimeRoot = join(process.resourcesPath, 'runtime')
  try {
    await stat(join(packagedRuntimeRoot, 'entry.mjs'))
    return packagedRuntimeRoot
  } catch {
    // Fall back to extracting legacy runtime.tar.gz into userData.
  }

  const archivePath = join(process.resourcesPath, 'runtime.tar.gz')
  const versionRoot = join(app.getPath('userData'), 'runtime', app.getVersion())
  try {
    await stat(join(versionRoot, 'entry.mjs'))
    return versionRoot
  } catch {
    // The versioned directory is incomplete or belongs to a failed extraction.
  }

  const stagingRoot = `${versionRoot}.staging-${process.pid}`
  await rm(stagingRoot, { recursive: true, force: true })
  await rm(versionRoot, { recursive: true, force: true })
  try {
    await stat(archivePath)
    await extractRuntimeArchive(archivePath, stagingRoot)
    await stat(join(stagingRoot, 'entry.mjs'))
    await mkdir(dirname(versionRoot), { recursive: true })
    await rename(stagingRoot, versionRoot)
    return versionRoot
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true })
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`desktop: failed to prepare the packaged runtime: ${detail}`)
  }
}
