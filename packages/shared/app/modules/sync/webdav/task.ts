import { getSettings } from '../../../common'
import { syncLXWebDAV } from '../external/lxWebdav'
import { sendSyncWebDAVStatus } from './shared'
import { state } from './state'
import { cancelSyncWebDAV, getSyncWebDAVState, runSyncWebDAV } from './sync'

const handleSync = async () => {
  const state = getSyncWebDAVState()
  if (state.status !== 'idle' && state.status !== 'error') return
  const settings = getSettings()
  if (settings['sync.lxWebdav.enable'] && settings['sync.webdav.url'] && settings['sync.webdav.username']) {
    await syncLXWebDAV({
      url: settings['sync.webdav.url'],
      username: settings['sync.webdav.username'],
      password: settings['sync.webdav.password'],
      path: settings['sync.lxWebdav.path'],
    }).catch((err: Error) => {
      console.warn('[LX N WebDAV] Failed to read remote playlist:', err.message)
    })
  }
  if (
    getSettings()['sync.webdav.enable'] &&
    !!getSettings()['sync.webdav.url'] &&
    !!getSettings()['sync.webdav.username'] &&
    !!getSettings()['sync.webdav.path'] &&
    (getSettings()['sync.webdav.syncEnable.dislike'] || getSettings()['sync.webdav.syncEnable.list'])
  ) {
    await runSyncWebDAV({
      url: getSettings()['sync.webdav.url'],
      username: getSettings()['sync.webdav.username'],
      password: getSettings()['sync.webdav.password'],
      path: getSettings()['sync.webdav.path'],
    })
  }
}
let webdavSyncTaskTimeout: NodeJS.Timeout | undefined
export const runWebDAVSyncTask = (immediately?: boolean) => {
  if (webdavSyncTaskTimeout) {
    clearTimeout(webdavSyncTaskTimeout)
    webdavSyncTaskTimeout = undefined
  }
  if (immediately) void handleSync()
  webdavSyncTaskTimeout = setTimeout(() => {
    webdavSyncTaskTimeout = undefined
    void handleSync().finally(() => {
      runWebDAVSyncTask()
    })
  }, 180_000)
  state.nextSyncTime = Date.now() + 180_000
  sendSyncWebDAVStatus()
}
export const cancelWebDAVSyncTask = () => {
  if (webdavSyncTaskTimeout) {
    clearTimeout(webdavSyncTaskTimeout)
    webdavSyncTaskTimeout = undefined
  }
  cancelSyncWebDAV()
}
