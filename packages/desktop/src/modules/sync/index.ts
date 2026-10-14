import {
  getSyncWebDAVState,
  configureNeteaseSessionProvider,
  runSyncWebDAV as runSyncWebDAVOriginal,
  cancelWebDAVSyncTask,
  runWebDAVSyncTask,
  type SyncWebDAVOptions,
  syncWebDAVEvent,
} from '@any-listen/app/modules/sync'

import { appEvent, appState, updateSetting } from '@/app'
import { readSecureNeteaseCookie, writeSecureNeteaseCookie } from '@/modules/neteaseLogin'

const init = (immediately?: boolean) => {
  if (appState.appSetting['sync.webdav.enable'] || appState.appSetting['sync.lxWebdav.enable'] || appState.appSetting['sync.netease.enable']) {
    runWebDAVSyncTask(immediately)
  } else {
    cancelWebDAVSyncTask()
  }
}
export const initSync = async () => {
  configureNeteaseSessionProvider({
    getCookie: async () => appState.appSetting['sync.netease.cookie'] || await readSecureNeteaseCookie(),
    saveCookie: async (cookie) => {
      await writeSecureNeteaseCookie(cookie)
      if (appState.appSetting['sync.netease.cookie']) updateSetting({ 'sync.netease.cookie': '' })
    },
  })
  appEvent.on('updated_config', (keys, settings) => {
    if (keys.some((key) => key === 'sync.webdav.enable' || key === 'sync.lxWebdav.enable' || key === 'sync.netease.enable')) {
      init()
    }
  })
  appEvent.on('inited', () => {
    init(true)
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
