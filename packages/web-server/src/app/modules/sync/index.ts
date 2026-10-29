import {
  getSyncWebDAVState,
  runLXSync,
  type LXSyncResolution,
  runSyncWebDAV as runSyncWebDAVOriginal,
  cancelWebDAVSyncTask,
  runWebDAVSyncTask,
  type SyncWebDAVOptions,
  syncWebDAVEvent,
} from '@any-listen/app/modules/sync'

import { appEvent, appState, updateSetting } from '@/app/app'

let lxnTimer: ReturnType<typeof setTimeout> | undefined
const autoSyncLX = async () => {
  if (!appState.appSetting['sync.lxn.enable']) return
  try { await runLXNSync() } catch (error) {
    console.warn('[LX-N] WebDAV sync skipped:', error instanceof Error ? error.message : error)
  }
}
const scheduleLXAuto = () => {
  if (lxnTimer) clearTimeout(lxnTimer)
  lxnTimer = undefined
  if (!appState.appSetting['sync.lxn.enable']) return
  lxnTimer = setTimeout(() => { void autoSyncLX().finally(scheduleLXAuto) }, 180_000)
}
export const runLXNSync = async (resolution?: LXSyncResolution) => {
  const setting = appState.appSetting
  if (!setting['sync.lxn.enable']) throw new Error('Enable LX-N sync first')
  const result = await runLXSync({
    url: setting['sync.webdav.url'],
    username: setting['sync.webdav.username'],
    password: setting['sync.webdav.password'],
    path: setting['sync.lxn.path'],
    baselineRemote: setting['sync.lxn.baselineRemote'],
    baselineLocal: setting['sync.lxn.baselineLocal'],
    writeEnabled: setting['sync.lxn.writeEnabled'],
  }, resolution)
  updateSetting({
    'sync.lxn.baselineRemote': result.baselineRemote,
    'sync.lxn.baselineLocal': result.baselineLocal,
  })
  return {
    action: result.action,
    listCount: result.listCount,
    remoteTimestamp: result.remoteTimestamp,
  }
}

/** LX-N uses a single playlists.json. Never run native snapshot uploads alongside it. */
const disableNativeWebDAVWhenLXActive = () => {
  const setting = appState.appSetting
  if (!setting['sync.lxn.enable']) return
  if (!setting['sync.webdav.enable'] &&
      !setting['sync.webdav.syncEnable.list'] &&
      !setting['sync.webdav.syncEnable.dislike']) return
  updateSetting({
    'sync.webdav.enable': false,
    'sync.webdav.syncEnable.list': false,
    'sync.webdav.syncEnable.dislike': false,
  })
}

const init = (immediately?: boolean) => {
  if (appState.appSetting['sync.webdav.enable'] && !appState.appSetting['sync.lxn.enable']) {
    runWebDAVSyncTask(immediately)
  } else {
    cancelWebDAVSyncTask()
  }
}
export const initSync = async () => {
  appEvent.on('updated_config', (keys, settings) => {
    if (keys.includes('sync.lxn.enable')) disableNativeWebDAVWhenLXActive()
    if (keys.includes('sync.webdav.enable') || keys.includes('sync.lxn.enable')) {
      init()
    }
    if (keys.some(k => k === 'sync.lxn.enable' || k === 'sync.lxn.path')) scheduleLXAuto()
  })
  appEvent.on('inited', () => {
    disableNativeWebDAVWhenLXActive()
    init(true)
    if (appState.appSetting['sync.lxn.enable']) void autoSyncLX()
    scheduleLXAuto()
  })
}

export const runSyncWebDAV = async (
  getListMergeMode: SyncWebDAVOptions['getListMergeMode'],
  getDislikeMergeMode: SyncWebDAVOptions['getDislikeMergeMode']
) => {
  if (appState.appSetting['sync.lxn.enable']) {
    throw new Error('LX-N single-file mode has disabled native WebDAV snapshot sync to prevent extra versions.')
  }
  return runSyncWebDAVOriginal(
    {
      url: appState.appSetting['sync.webdav.url'],
      username: appState.appSetting['sync.webdav.username'],
      password: appState.appSetting['sync.webdav.password'],
      path: appState.appSetting['sync.webdav.path'],
    },
    {
      getListMergeMode,
      getDislikeMergeMode,
    }
  )
}

export const onWebDAVSyncStatusChanged = (callback: (state: AnyListen.IPCSync.SyncState['webdav']) => void | Promise<void>) => {
  syncWebDAVEvent.on('statusChanged', callback)
}

export { getSyncWebDAVState }
