import { runWebDAVSyncTask } from '@any-listen/app/modules/sync'
import { BrowserWindow, session } from 'electron'

import { updateSetting } from '@/app'

import {
  AUTH_PARTITIONS,
  isNeteaseAccountVerified,
  musicCookieHeader,
  neteaseHasAuthenticatedCookie,
} from './accountLoginPolicy'
import { accountVaultAvailable, readAccountSecret, writeAccountSecret } from './accountVault'

export const NETEASE_AUTH_PARTITION = AUTH_PARTITIONS.netease
export const readSecureNeteaseCookie = () => readAccountSecret('netease')
export const writeSecureNeteaseCookie = (cookie: string) => writeAccountSecret('netease', cookie)

let pendingLogin: Promise<boolean> | undefined

/**
 * Login inside AnySynListen rather than the external Chrome profile.
 * The Chromium session is persistent, isolated, sandboxed, and owns HttpOnly cookies.
 * Only the native main process receives/validates the session; no script injection,
 * password reading or cookie access from a renderer/extension is needed.
 */
export const openNeteaseLoginWindow = (): Promise<boolean> => {
  if (pendingLogin) return pendingLogin
  if (!accountVaultAvailable()) return Promise.reject(new Error('系统安全凭据存储不可用，请启用系统钥匙串'))
  pendingLogin = new Promise<boolean>((resolve, reject) => {
    const authSession = session.fromPartition(NETEASE_AUTH_PARTITION)
    const win = new BrowserWindow({
      title: '网易云音乐 · 登录',
      width: 610, height: 760, minWidth: 470, minHeight: 600,
      show: true,
      webPreferences: {
        partition: NETEASE_AUTH_PARTITION,
        nodeIntegration: false, contextIsolation: true,
        sandbox: true, webSecurity: true,
      },
    })
    // Keep the user on the official mobile login page, which supports phone
    // verification. Official SSO child windows are handled in app/index.ts.
    win.webContents.setUserAgent(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
    )
    let finished = false
    let loginPrepared = false
    let verifying = false
    let lastCheck = 0

    const setTitle = (status: string) => {
      if (!win.isDestroyed()) win.setTitle('网易云音乐 · ' + status)
    }
    const release = () => {
      clearInterval(poll)
      authSession.cookies.removeListener('changed', onCookieChanged)
    }
    const finish = (ok: boolean) => {
      if (finished) return
      finished = true
      release()
      if (!win.isDestroyed()) win.close()
      resolve(ok)
    }
    const fail = (error: Error) => {
      if (finished) return
      finished = true
      release()
      if (!win.isDestroyed()) win.close()
      reject(error)
    }
    const verify = async () => {
      if (!loginPrepared || finished || verifying || Date.now() - lastCheck < 1500) return
      lastCheck = Date.now()
      verifying = true
      try {
        const cookies = await authSession.cookies.get({ url: 'https://music.163.com/' })
        // The session includes HttpOnly cookies that window.document.cookie
        // deliberately cannot see. Only provider cookies go to the vault.
        const providerCookies = cookies.filter(({ name }) =>
          ['MUSIC_U', '__csrf', 'MUSIC_A', 'NMTID', 'os', 'appver'].includes(name)
        )
        const cookie = musicCookieHeader(providerCookies)
        if (!neteaseHasAuthenticatedCookie(cookie)) return
        setTitle('正在验证登录信息')
        // Critical: validate through the SAME Chromium session that rendered
        // the page, not Node's separate fetch cookie jar.
        const resp = await authSession.fetch('https://music.163.com/api/nuser/account/get', {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json', Referer: 'https://music.163.com/' },
        })
        if (!resp.ok) {
          setTitle('账号验证网络异常，正在重试')
          return
        }
        const data: unknown = await resp.json()
        if (!isNeteaseAccountVerified(data)) {
          setTitle('已检测登录凭据，请在页面完成验证')
          return
        }
        await writeSecureNeteaseCookie(cookie)
        updateSetting({ 'sync.netease.cookie': '', 'sync.netease.enable': true })
        finish(true)
        // Actual playlist sync is independent of login success.
        runWebDAVSyncTask(true)
      } catch {
        setTitle('账号校验暂未完成，正在重试')
      } finally {
        verifying = false
      }
    }
    const onCookieChanged = (_event: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
      if (!removed && ['MUSIC_U', '__csrf', 'MUSIC_A'].includes(cookie.name)) void verify()
    }
    const poll = setInterval(() => { void verify() }, 4000)
    authSession.cookies.on('changed', onCookieChanged)
    win.webContents.on('did-finish-load', () => { void verify() })
    win.webContents.on('did-navigate', () => { void verify() })
    win.webContents.on('did-navigate-in-page', () => { void verify() })
    win.on('closed', () => { finish(false) })
    // Clicking 登录 is an explicit interactive re-authentication request.
    // Previously an old Chromium MUSIC_U cookie was checked immediately and
    // the popup closed before the user could actually log in or switch account.
    // Preserve the separately encrypted vault entry until NEW validation
    // succeeds, but start the login BrowserWindow with clean Chromium cookies.
    void (async () => {
      try {
        await authSession.clearStorageData({ storages: ['cookies', 'localstorage'] })
        if (finished) return
        loginPrepared = true
        await win.loadURL('https://music.163.com/m/login')
      } catch (error) {
        fail(new Error('无法打开网易云官方登录窗口：' + (error as Error).message))
      }
    })()
  }).finally(() => { pendingLogin = undefined })
  return pendingLogin
}
