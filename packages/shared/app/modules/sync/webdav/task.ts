import { getSettings } from '../../../common'
import { syncLXWebDAV } from '../external/lxWebdav'
import { syncQQMusicAccount, syncQQMusicDaily, type QQMusicCredential } from '../external/qqMusic'
import { syncKugouAccount, syncKugouDaily, type KugouAccount } from '../external/kugouMusic'
import { syncNeteaseAccount, syncNeteaseDaily } from '../external/netease'
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
let saveLXBaseline: ((baseline: string) => Promise<void> | void) | undefined
export const configureLXBaselineSaver = (save: typeof saveLXBaseline) => {
  saveLXBaseline = save
}

export type ExternalSyncProvider = 'netease' | 'qq' | 'kugou' | 'lx'
export interface ExternalSyncResult {
  status: 'idle' | 'syncing' | 'success' | 'error'
  lastSuccess: number
  lastTry: number
  error?: string
}
const externalStatus: Record<ExternalSyncProvider, ExternalSyncResult> = {
  netease: { status: 'idle', lastSuccess: 0, lastTry: 0 },
  qq: { status: 'idle', lastSuccess: 0, lastTry: 0 },
  kugou: { status: 'idle', lastSuccess: 0, lastTry: 0 },
  lx: { status: 'idle', lastSuccess: 0, lastTry: 0 },
}
export const getExternalSyncState = (): Record<ExternalSyncProvider, ExternalSyncResult> => ({
  netease: { ...externalStatus.netease },
  qq: { ...externalStatus.qq },
  kugou: { ...externalStatus.kugou },
  lx: { ...externalStatus.lx },
})
const start = (provider: ExternalSyncProvider) => {
  externalStatus[provider] = { ...externalStatus[provider], status: 'syncing', lastTry: Date.now(), error: undefined }
}
const succeed = (provider: ExternalSyncProvider) => {
  externalStatus[provider] = { ...externalStatus[provider], status: 'success', lastSuccess: Date.now(), error: undefined }
}
const fail = (provider: ExternalSyncProvider, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  // Never expose sensitive credential strings or authorization headers via the renderer.
  externalStatus[provider] = {
    ...externalStatus[provider], status: 'error',
    error: message.replace(/(MUSIC_U|qqmusic_key|token|password)=[^;&\s]+/ig, '$1=[redacted]').slice(0, 240),
  }
}

const OTHER_SYNC_INTERVAL = 3 * 60 * 60 * 1000
const OTHER_RETRY_INTERVAL = 30 * 60 * 1000
const otherStatus = {
  qq: { identity: '', lastSync: 0, lastTry: 0, running: false },
  kugou: { identity: '', lastSync: 0, lastTry: 0, running: false },
}
const syncOtherOne = async (key: 'qq' | 'kugou', forced = false, dailyOnly = false) => {
  if (!otherMusicSessionProvider) {
    if (forced) throw new Error('Desktop account session provider is unavailable')
    return
  }
  const settings = getSettings()
  if (!settings[key === 'qq' ? 'sync.qq.enable' : 'sync.kugou.enable']) {
    if (forced) throw new Error('Please enable account sync first')
    return
  }
  const credential = key === 'qq'
    ? await otherMusicSessionProvider.getQQ()
    : await otherMusicSessionProvider.getKugou()
  if (!credential) {
    if (forced) throw new Error('请先完成平台账号登录')
    return
  }
  const status = otherStatus[key]
  if (status.running) return
  const identity = JSON.stringify(credential)
  if (identity !== status.identity) {
    status.identity = identity
    status.lastSync = 0
    status.lastTry = 0
  }
  const now = Date.now()
  if (!forced && (now - status.lastTry < OTHER_RETRY_INTERVAL || now - status.lastSync < OTHER_SYNC_INTERVAL)) return
  status.lastTry = now
  status.running = true
  start(key)
  try {
    if (key === 'qq') {
      if (dailyOnly) await syncQQMusicDaily(credential as QQMusicCredential)
      else await syncQQMusicAccount(credential as QQMusicCredential)
    } else {
      if (dailyOnly) await syncKugouDaily(credential as KugouAccount)
      else await syncKugouAccount(credential as KugouAccount)
    }
    if (!dailyOnly) status.lastSync = Date.now()
    succeed(key)
  } catch (err) {
    fail(key, err)
    console.warn('[' + key + '] Account mirror failed:', (err as Error).message)
    if (forced) throw err
  } finally {
    status.running = false
  }
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

const syncNeteaseIfDue = async (forced = false, dailyOnly = false) => {
  const settings = getSettings()
  if (!settings['sync.netease.enable']) {
    if (forced) throw new Error('请先开启网易云账号同步')
    return
  }
  if (neteaseSyncInProgress) return
  let cookie = await neteaseSessionProvider?.getCookie() ?? settings['sync.netease.cookie']
  if (!cookie) {
    if (forced) throw new Error('请先登录网易云音乐')
    return
  }
  if (cookie !== neteaseLastCookie) {
    neteaseLastCookie = cookie
    neteaseLastSync = 0
    neteaseLastTry = 0
    neteaseLastRefresh = 0
    reauthNotified = false
  }
  const now = Date.now()
  if (!forced && (now - neteaseLastSync < NETEASE_LIST_INTERVAL || now - neteaseLastTry < NETEASE_RETRY_INTERVAL)) return
  neteaseSyncInProgress = true
  neteaseLastTry = now
  start('netease')
  try {
    if (!dailyOnly && now - neteaseLastRefresh >= NETEASE_REFRESH_INTERVAL) {
      neteaseLastRefresh = now
      try {
        const refreshed = await refreshNeteaseCookie(cookie)
        if (refreshed !== cookie && neteaseSessionProvider) {
          await neteaseSessionProvider.saveCookie(refreshed)
          cookie = refreshed
          neteaseLastCookie = refreshed
        }
      } catch {
        console.warn('[NetEase] Session refresh unavailable; using existing session')
      }
    }
    if (dailyOnly) await syncNeteaseDaily(cookie)
    else {
      await syncNeteaseAccount(cookie)
      neteaseLastSync = Date.now()
    }
    reauthNotified = false
    succeed('netease')
  } catch (err) {
    fail('netease', err)
    const message = (err as Error).message
    console.warn('[NetEase] Account synchronization failed:', message)
    if (!reauthNotified && /\b(301|401)\b|expired|not authenticated|login expired/i.test(message)) {
      reauthNotified = true
      await neteaseSessionProvider?.notifyReauth?.()
    }
    if (forced) throw err
  } finally {
    neteaseSyncInProgress = false
  }
}

let lxRunning = false
const syncLXIfDue = async (forced = false) => {
  const settings = getSettings()
  if (!settings['sync.lxWebdav.enable'] || !settings['sync.webdav.url'] || !settings['sync.webdav.username']) {
    if (forced) throw new Error('请先启用 LX-N 和配置 WebDAV')
    return
  }
  if (lxRunning) return
  lxRunning = true
  start('lx')
  try {
    await syncLXWebDAV({
      url: settings['sync.webdav.url'],
      username: settings['sync.webdav.username'],
      password: settings['sync.webdav.password'],
      path: settings['sync.lxWebdav.path'],
      writeEnable: settings['sync.lxWebdav.writeEnable'] && settings['sync.lxWebdav.writeInitialized'],
      baseline: settings['sync.lxWebdav.baseline'],
      saveBaseline: saveLXBaseline,
    })
    succeed('lx')
  } catch (err) {
    fail('lx', err)
    console.warn('[LX N WebDAV] Sync failed:', (err as Error).message)
    if (forced) throw err
  } finally {
    lxRunning = false
  }
}

/** Manual refresh bypasses the three-hour provider cache, but is never a login. */
export const runExternalSyncNow = async (provider: ExternalSyncProvider, dailyOnly = false) => {
  try {
    switch (provider) {
      case 'netease':
        return await syncNeteaseIfDue(true, dailyOnly)
      case 'qq':
      case 'kugou':
        return await syncOtherOne(provider, true, dailyOnly)
      case 'lx':
        if (dailyOnly) throw new Error('LX-N 日推由手机端生成；这里只能同步已有歌单')
        return await syncLXIfDue(true)
    }
  } catch (err) {
    // Covers preflight failures as well as network errors (e.g. no account
    // session); the renderer never needs to catch a secret-bearing exception.
    fail(provider, err)
    throw err
  }
}

let taskInProgress = false
const handleSync = async () => {
  if (taskInProgress) return
  taskInProgress = true
  try {
    await Promise.allSettled([syncNeteaseIfDue(), syncOtherOne('qq'), syncOtherOne('kugou'), syncLXIfDue()])
    const settings = getSettings()
    const current = getSyncWebDAVState()
    if (current.status !== 'idle' && current.status !== 'error') return
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
  } finally {
    taskInProgress = false
  }
}

let webdavSyncTaskTimeout: NodeJS.Timeout | undefined
export const runWebDAVSyncTask = (immediately?: boolean) => {
  if (webdavSyncTaskTimeout) {
    clearTimeout(webdavSyncTaskTimeout)
    webdavSyncTaskTimeout = undefined
  }
  if (immediately) void handleSync().catch((err) => console.warn('[Sync task]', (err as Error).message))
  webdavSyncTaskTimeout = setTimeout(() => {
    webdavSyncTaskTimeout = undefined
    void handleSync().finally(() => {
      runWebDAVSyncTask()
    })
  }, 60_000)
  state.nextSyncTime = Date.now() + 60_000
  sendSyncWebDAVStatus()
}
export const cancelWebDAVSyncTask = () => {
  if (webdavSyncTaskTimeout) {
    clearTimeout(webdavSyncTaskTimeout)
    webdavSyncTaskTimeout = undefined
  }
  cancelSyncWebDAV()
}
