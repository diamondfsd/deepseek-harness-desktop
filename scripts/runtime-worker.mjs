import { stdin, stdout } from 'node:process'

const dshHome = process.env.DSH_HOME
const cwd = process.env.DSH_CWD ?? process.cwd()

function errorMessage(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}

async function main() {
  if (dshHome === undefined || dshHome === '') throw new Error('DSH_HOME is required')
  const { startDshWeb } = await import(new URL('./entry.mjs', import.meta.url).href)
  const runtime = await startDshWeb({ dshHome, cwd })
  stdout.write(JSON.stringify({ type: 'ready', url: runtime.url }) + '\n')

  let stopping
  const stop = () => {
    stopping ??= runtime.stop().then(() => process.exit(0))
    return stopping
  }
  stdin.setEncoding('utf8')
  stdin.on('data', chunk => {
    if (chunk.includes('stop')) void stop()
  })
  process.once('SIGTERM', () => { void stop() })
  process.once('SIGINT', () => { void stop() })
}

main().catch(error => {
  stdout.write(JSON.stringify({ type: 'error', error: errorMessage(error) }) + '\n')
  process.exitCode = 1
})
