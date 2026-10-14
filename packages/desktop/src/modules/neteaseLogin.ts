import { getNeteaseAccountId, runWebDAVSyncTask } from '@any-listen/app/modules/sync'
import { BrowserWindow, session } from 'electron'

import { updateSetting } from '@/app'

import { accountVaultAvailable, readAccountSecret, writeAccountSecret } from './accountVault'

export const NETEASE_AUTH_PARTITION = 'persist:netease-auth'
export const readSecureNeteaseCookie = () => readAccountSecret('netease')
export const writeSecureNeteaseCookie = (cookie: string) => writeAccountSecret('netease', cookie)
const secureAvailable = accountVaultAvailable

let pendingLogin: Promise<boolean> | undefined

/**
 * A sandboxed official NetEase page receives the phone/SMS/QR interaction.
 * Never inject JavaScript, intercept passwords or read document.cookie.
 * Electron's session cookie API can read HttpOnly auth cookies safely in main.
 */
export const openNeteaseLoginWindow = (): Promise<boolean> => {
  if (pendingLogin) return pendingLogin
  if (!secureAvailable()) return Promise.reject(new Error('系统安全凭据存储不可用，请使用手动 Cookie 模式'))
  pendingLogin = new Promise<boolean>((resolve, reject) => {
    const authSession = session.fromPartition(NETEASE_AUTH_PARTITION)
    const win = new BrowserWindow({
      title: '网易云音乐 · 官方登录',
      width: 470,
      height: 690,
      minWidth: 420,
      minHeight: 520,
      show: true,
      webPreferences: {
        partition: NETEASE_AUTH_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    let finished = false
    let verifying = false
    let lastAttempt = 0
    const poll = setInterval(() => { void verify() }, 5000)
    // The URL is a mobile login page. Use a consistent mobile UA rather
    // than changing it on each request (which can shorten the session).
    win.webContents.setUserAgent(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
    )
    const finish = (ok: boolean) => {
      if (finished) return
      finished = true
      clearInterval(poll)
      authSession.cookies.removeListener('changed', onCookiesChanged)
      if (!win.isDestroyed()) win.close()
      resolve(ok)
    }
    const verify = async () => {
      if (finished || verifying || Date.now() - lastAttempt < 2000) return
      verifying = true
      lastAttempt = Date.now()
      try {
        const browserCookies = await authSession.cookies.get({ url: 'https://music.163.com/' })
        const cookie = browserCookies.map((item) => item.name + '=' + item.value).join('; ')
        if (!/(?:^|;\s*)MUSIC_U=/.test(cookie)) return
        await getNeteaseAccountId(cookie)
        await writeSecureNeteaseCookie(cookie)
        // Remove any legacy plaintext credential after obtaining the secure one.
        updateSetting({ 'sync.netease.cookie': '', 'sync.netease.enable': true })
        runWebDAVSyncTask(true)
        finish(true)
      } catch {
        // The official login flow might still be completing a challenge.
      } finally {
        verifying = false
      }
    }
    const onCookiesChanged = (_event: Electron.Event, changed: Electron.Cookie) => {
      if (changed.name === 'MUSIC_U' || changed.name === '__csrf' || changed.name === 'S_INFO') {
        void verify()
      }
    }
    authSession.cookies.on('changed', onCookiesChanged)
    win.webContents.on('did-finish-load', () => { void verify() })
    win.webContents.on('did-navigate', () => { void verify() })
    win.on('closed', () => {
      if (!finished) finish(false)
    })
    void win.loadURL('https://music.163.com/m/login').catch((err: Error) => {
      if (finished) return
      finished = true
      clearInterval(poll)
      authSession.cookies.removeListener('changed', onCookiesChanged)
      reject(new Error('无法打开网易云官方登录网页：' + err.message))
      if (!win.isDestroyed()) win.close()
    })
  }).finally(() => {
    pendingLogin = undefined
  })
  return pendingLogin
}
