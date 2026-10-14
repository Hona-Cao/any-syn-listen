import { getSettings } from '../../../common'
import { syncLXWebDAV } from '../external/lxWebdav'
import { syncQQMusicAccount, type QQMusicCredential } from '../external/qqMusic'
import { syncKugouAccount, type KugouAccount } from '../external/kugouMusic'
import { syncNeteaseAccount } from '../external/netease'
import { refreshNeteaseCookie } from '../external/neteaseSession'
import { sendSyncWebDAVStatus } from './shared'
import { state } from './state'
import { cancelSyncWebDAV, getSyncWebDAVState, runSyncWebDAV } from './sync'

export interface NeteaseSessionProvider {
  getCookie: () => Promise<string>
  saveCookie: (cookie: string) => Promise<void>
  notifyReauth?: () => void | Promise<void>
}
let neteaseSessionProvider: NeteaseSessionProvider | undefined
export const configureNeteaseSessionProvider = (provider: NeteaseSessionProvider) => {
  neteaseSessionProvider = provider
}
export interface OtherMusicSessionProvider {
  getQQ: () => Promise<QQMusicCredential | null>
  getKugou: () => Promise<KugouAccount | null>
}
let otherMusicSessionProvider: OtherMusicSessionProvider | undefined
export const configureOtherMusicSessionProvider = (provider: OtherMusicSessionProvider) => {
  otherMusicSessionProvider = provider
}
const OTHER_SYNC_INTERVAL = 3 * 60 * 60 * 1000
const OTHER_RETRY_INTERVAL = 30 * 60 * 1000
const otherStatus = {
  qq: { identity: '', lastSync: 0, lastTry: 0, running: false },
  kugou: { identity: '', lastSync: 0, lastTry: 0, running: false },
}
const syncOtherMusicIfDue = async () => {
  if (!otherMusicSessionProvider) return
  const settings = getSettings()
  const run = async (
    key: keyof typeof otherStatus,
    enabled: boolean,
    credential: QQMusicCredential | KugouAccount | null,
    sync: () => Promise<unknown>
  ) => {
    if (!enabled || !credential) return
    const status = otherStatus[key]
    if (status.running) return
    const identity = JSON.stringify(credential)
    if (identity !== status.identity) {
      status.identity = identity
      status.lastSync = 0
      status.lastTry = 0
    }
    const now = Date.now()
    if (now - status.lastTry < OTHER_RETRY_INTERVAL || now - status.lastSync < OTHER_SYNC_INTERVAL) return
    status.lastTry = now
    status.running = true
    try {
      await sync()
      status.lastSync = Date.now()
    } catch (err) {
      console.warn('[' + key + '] Account mirror failed:', (err as Error).message)
    } finally {
      status.running = false
    }
  }
  const [qq, kg] = await Promise.all([
    settings['sync.qq.enable'] ? otherMusicSessionProvider.getQQ() : Promise.resolve(null),
    settings['sync.kugou.enable'] ? otherMusicSessionProvider.getKugou() : Promise.resolve(null),
  ])
  await Promise.all([
    run('qq', settings['sync.qq.enable'], qq, () => syncQQMusicAccount(qq as QQMusicCredential)),
    run('kugou', settings['sync.kugou.enable'], kg, () => syncKugouAccount(kg as KugouAccount)),
  ])
}

const NETEASE_LIST_INTERVAL = 3 * 60 * 60 * 1000
const NETEASE_REFRESH_INTERVAL = 18 * 60 * 60 * 1000
const NETEASE_RETRY_INTERVAL = 30 * 60 * 1000
let neteaseLastSync = 0
let neteaseLastTry = 0
let neteaseLastRefresh = 0
let neteaseLastCookie = ''
let neteaseSyncInProgress = false
let reauthNotified = false

const syncNeteaseIfDue = async () => {
  const settings = getSettings()
  if (!settings['sync.netease.enable'] || neteaseSyncInProgress) return
  let cookie = await neteaseSessionProvider?.getCookie() ?? settings['sync.netease.cookie']
  if (!cookie) return
  if (cookie !== neteaseLastCookie) {
    neteaseLastCookie = cookie
    neteaseLastSync = 0
    neteaseLastTry = 0
    neteaseLastRefresh = 0
    reauthNotified = false
  }
  const now = Date.now()
  if (now - neteaseLastSync < NETEASE_LIST_INTERVAL || now - neteaseLastTry < NETEASE_RETRY_INTERVAL) return
  neteaseSyncInProgress = true
  neteaseLastTry = now
  try {
    // Attempt once per 18 hours; a QR/webview cookie may not be refreshable.
    // Never re-login or retry requests rapidly after platform errors.
    if (now - neteaseLastRefresh >= NETEASE_REFRESH_INTERVAL) {
      neteaseLastRefresh = now
      try {
        const refreshed = await refreshNeteaseCookie(cookie)
        if (refreshed !== cookie && neteaseSessionProvider) {
          await neteaseSessionProvider.saveCookie(refreshed)
          cookie = refreshed
          neteaseLastCookie = refreshed
        }
      } catch {
        console.warn('[NetEase] Refresh unavailable; existing session will be checked')
      }
    }
    await syncNeteaseAccount(cookie)
    neteaseLastSync = Date.now()
    reauthNotified = false
  } catch (err) {
    const message = (err as Error).message
    console.warn('[NetEase] Account synchronization failed:', message)
    if (!reauthNotified && /\b(301|401)\b|expired|not authenticated|login expired/i.test(message)) {
      reauthNotified = true
      await neteaseSessionProvider?.notifyReauth?.()
    }
  } finally {
    neteaseSyncInProgress = false
  }
}
const handleSync = async () => {
  const current = getSyncWebDAVState()
  if (current.status !== 'idle' && current.status !== 'error') return
  const settings = getSettings()
  await Promise.all([syncNeteaseIfDue(), syncOtherMusicIfDue()])
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
    settings['sync.webdav.enable'] &&
    !!settings['sync.webdav.url'] &&
    !!settings['sync.webdav.username'] &&
    !!settings['sync.webdav.path'] &&
    (settings['sync.webdav.syncEnable.dislike'] || settings['sync.webdav.syncEnable.list'])
  ) {
    await runSyncWebDAV({
      url: settings['sync.webdav.url'],
      username: settings['sync.webdav.username'],
      password: settings['sync.webdav.password'],
      path: settings['sync.webdav.path'],
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
