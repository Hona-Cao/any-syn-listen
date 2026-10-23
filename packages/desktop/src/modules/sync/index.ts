import {
  getSyncWebDAVState,
  runLXSync,
  runSyncWebDAV as runSyncWebDAVOriginal,
  cancelWebDAVSyncTask,
  runWebDAVSyncTask,
  type SyncWebDAVOptions,
  syncWebDAVEvent,
} from '@any-listen/app/modules/sync'

import { appEvent, appState, updateSetting } from '@/app'

let lxnTimer: ReturnType<typeof setTimeout> | undefined
const runLXNAutoSync = async () => {
  if (!appState.appSetting['sync.lxn.enable']) return
  try { await runLXNSync() } catch (e) {
    console.warn('[LX-N sync] auto-sync skipped:', e instanceof Error ? e.message : e)
  }
}
const scheduleLXNAuto = () => {
  if (lxnTimer) clearTimeout(lxnTimer)
  lxnTimer = undefined
  if (!appState.appSetting['sync.lxn.enable']) return
  lxnTimer = setTimeout(() => {
    void runLXNAutoSync().finally(scheduleLXNAuto)
  }, 180_000)
}
export const runLXNSync = async () => {
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
  })
  updateSetting({
    'sync.lxn.baselineRemote': result.baselineRemote,
    'sync.lxn.baselineLocal': result.baselineLocal,
  })
  return { action: result.action, listCount: result.listCount, remoteTimestamp: result.remoteTimestamp }
}

const init = (immediately?: boolean) => {
  if (appState.appSetting['sync.webdav.enable']) {
    runWebDAVSyncTask(immediately)
  } else {
    cancelWebDAVSyncTask()
  }
}
export const initSync = async () => {
  appEvent.on('updated_config', (keys, settings) => {
    if (keys.includes('sync.webdav.enable')) {
      init()
    }
    if (keys.some(key => key === 'sync.lxn.enable' || key === 'sync.lxn.path')) scheduleLXNAuto()
  })
  appEvent.on('inited', () => {
    init(true)
    if (appState.appSetting['sync.lxn.enable']) void runLXNAutoSync()
    scheduleLXNAuto()
  })
}

export const runSyncWebDAV = async (
  getListMergeMode: SyncWebDAVOptions['getListMergeMode'],
  getDislikeMergeMode: SyncWebDAVOptions['getDislikeMergeMode']
) => {
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

export { syncWebDAVEvent } from '@any-listen/app/modules/sync'
