import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { ensureRuntimeRoot } from './runtime'

interface HarnessRuntime {
  url: string
  stop: () => Promise<void>
}

let mainWindow: BrowserWindow | undefined
let harness: HarnessRuntime | undefined
let quitting = false

async function runtimeWorkerPath(): Promise<string> {
  return join(await ensureRuntimeRoot(), 'worker.mjs')
}

async function startHarness(): Promise<HarnessRuntime> {
  const workerPath = await runtimeWorkerPath()
  const dshHome = join(app.getPath('userData'), 'harness')
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [
    '--expose-internals',
    workerPath,
  ], {
    cwd: app.getPath('home'),
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      DSH_CWD: app.getPath('home'),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let output = ''
  let errorOutput = ''
  let settled = false
  let resolveExit!: () => void
  const exit = new Promise<void>(resolve => { resolveExit = resolve })
  child.once('exit', () => { resolveExit() })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { errorOutput += chunk })

  return new Promise<HarnessRuntime>((resolve, reject) => {
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      const detail = error instanceof Error ? error.message : String(error)
      const diagnostics = errorOutput.trim()
      reject(new Error(diagnostics === '' ? detail : `${detail}\n${diagnostics}`))
    }
    const consume = (chunk: string): void => {
      output += chunk
      let newline = output.indexOf('\n')
      while (newline !== -1) {
        const line = output.slice(0, newline).trim()
        output = output.slice(newline + 1)
        newline = output.indexOf('\n')
        if (line === '') continue
        try {
          const message = JSON.parse(line) as { type?: string; url?: unknown; error?: unknown }
          if (message.type === 'ready' && typeof message.url === 'string') {
            settled = true
            resolve({
              url: message.url,
              stop: async () => {
                if (child.exitCode !== null || child.signalCode !== null) return
                child.stdin.write('stop\n')
                child.stdin.end()
                await Promise.race([
                  exit,
                  new Promise<void>(finish => setTimeout(finish, 5000)),
                ])
                if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
                await exit
              },
            })
          } else if (message.type === 'error') {
            fail(new Error(typeof message.error === 'string' ? message.error : 'runtime failed to start'))
          }
        } catch {
          // The web profile prints its URL for CLI users; only JSON lines are
          // part of the desktop worker protocol.
        }
      }
    }
    child.stdout.on('data', consume)
    child.once('error', fail)
    child.once('exit', (code, signal) => {
      if (!settled) {
        const suffix = signal === null ? ` (exit ${String(code)})` : ` (${signal})`
        fail(new Error(`runtime worker exited${suffix}`))
      }
    })
  })
}

function createWindow(initialUrl?: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  void (initialUrl === undefined
    ? rendererUrl === undefined
      ? window.loadFile(join(__dirname, '../renderer/index.html'))
      : window.loadURL(rendererUrl)
    : window.loadURL(initialUrl))
  return window
}

async function stopHarness(): Promise<void> {
  const current = harness
  harness = undefined
  if (current !== undefined) await current.stop()
}

async function boot(): Promise<void> {
  mainWindow = createWindow()
  try {
    harness = await startHarness()
    await mainWindow.loadURL(harness.url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await dialog.showMessageBox({
      type: 'error',
      title: 'DeepSeek Harness failed to start',
      message,
      buttons: ['Quit'],
    })
    app.quit()
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') Menu.setApplicationMenu(null)
  return boot()
}).catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  void dialog.showErrorBox('DeepSeek Harness failed to start', message)
  app.quit()
})

app.on('activate', () => {
  if (mainWindow === undefined && harness !== undefined) mainWindow = createWindow(harness.url)
})

app.on('before-quit', event => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void stopHarness().finally(() => app.exit(0))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
