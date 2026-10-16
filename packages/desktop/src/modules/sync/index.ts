import { Notification } from 'electron'

import {
  getSyncWebDAVState,
  getExternalSyncState,
  runExternalSyncNow as runExternalSyncNowOriginal,
  deleteLXPlaylistsNow as deleteLXPlaylistsNowOriginal,
  configureLXBaselineSaver,
  type ExternalSyncProvider,
  configureNeteaseSessionProvider,
  configureOtherMusicSessionProvider,
  runSyncWebDAV as runSyncWebDAVOriginal,
  cancelWebDAVSyncTask,
  runWebDAVSyncTask,
  type SyncWebDAVOptions,
  syncWebDAVEvent,
} from '@any-listen/app/modules/sync'

import { appEvent, appState, updateSetting } from '@/app'
import { readSecureNeteaseCookie, writeSecureNeteaseCookie } from '@/modules/neteaseLogin'
import { readAccountSecret } from '@/modules/accountVault'

const init = (immediately?: boolean) => {
  if (appState.appSetting['sync.webdav.enable'] || appState.appSetting['sync.lxWebdav.enable'] || appState.appSetting['sync.netease.enable'] || appState.appSetting['sync.qq.enable'] || appState.appSetting['sync.kugou.enable']) {
    runWebDAVSyncTask(immediately)
  } else {
    cancelWebDAVSyncTask()
  }
}
export const initSync = async () => {
  configureOtherMusicSessionProvider({
    getQQ: async () => {
      const raw = await readAccountSecret('qqmusic')
      return raw ? JSON.parse(raw) as import('@any-listen/app/modules/sync/external/qqMusic').QQMusicCredential : null
    },
    getKugou: async () => {
      const raw = await readAccountSecret('kugou')
      return raw ? JSON.parse(raw) as import('@any-listen/app/modules/sync/external/kugouMusic').KugouAccount : null
    },
  })
  configureLXBaselineSaver((baseline) => {
    const settings = appState.appSetting
    if (settings['sync.lxWebdav.baseline'] !== baseline ||
        (settings['sync.lxWebdav.writeEnable'] && !settings['sync.lxWebdav.writeInitialized'])) {
      updateSetting({
        'sync.lxWebdav.baseline': baseline,
        'sync.lxWebdav.writeInitialized': settings['sync.lxWebdav.writeEnable'],
      })
    }
  })
  configureNeteaseSessionProvider({
    getCookie: async () => appState.appSetting['sync.netease.cookie'] || await readSecureNeteaseCookie(),
    saveCookie: async (cookie) => {
      await writeSecureNeteaseCookie(cookie)
      if (appState.appSetting['sync.netease.cookie']) updateSetting({ 'sync.netease.cookie': '' })
    },
    notifyReauth: () => {
      if (Notification.isSupported()) new Notification({
        title: 'AnyListen · 网易云登录已失效',
        body: '请进入设置，重新通过官方登录窗口授权。歌单数据不会被删除。',
      }).show()
    },
  })
  appEvent.on('updated_config', (keys, settings) => {
    if (keys.some((key) => key === 'sync.webdav.enable' || key === 'sync.lxWebdav.enable' || key === 'sync.netease.enable' || key === 'sync.qq.enable' || key === 'sync.kugou.enable')) {
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

export { getSyncWebDAVState, getExternalSyncState }
export const runExternalSyncNow = (provider: ExternalSyncProvider, dailyOnly?: boolean) => runExternalSyncNowOriginal(provider, dailyOnly)
export const deleteLXPlaylistsNow = (remoteUserIds: string[]) => deleteLXPlaylistsNowOriginal(remoteUserIds)

export { syncWebDAVEvent } from '@any-listen/app/modules/sync'
