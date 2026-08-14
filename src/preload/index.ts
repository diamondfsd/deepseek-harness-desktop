import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
})
