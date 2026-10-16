import { runWebDAVSyncTask } from '@any-listen/app/modules/sync'
import { validateQQMusicCredential } from '@any-listen/app/modules/sync/external/qqMusic'
import { BrowserWindow, session } from 'electron'

import { updateSetting } from '@/app'

import { AUTH_PARTITIONS, qqCredentialFromSession } from './accountLoginPolicy'
import { accountVaultAvailable, writeAccountSecret } from './accountVault'

export const QQ_AUTH_PARTITION = AUTH_PARTITIONS.qqmusic

let pendingLogin: Promise<boolean> | undefined

/** No injected scripts, no browser localStorage access, no password capture. */
export const openQQMusicLoginWindow = (): Promise<boolean> => {
  if (pendingLogin) return pendingLogin
  if (!accountVaultAvailable()) return Promise.reject(new Error('系统安全凭据存储不可用，请先启用系统钥匙串'))
  pendingLogin = new Promise<boolean>((resolve, reject) => {
    const ses = session.fromPartition(QQ_AUTH_PARTITION)
    const win = new BrowserWindow({
      title: 'QQ 音乐 · 官方登录',
      width: 900, height: 720, minWidth: 500, minHeight: 550,
      webPreferences: {
        partition: QQ_AUTH_PARTITION,
        nodeIntegration: false,
        sandbox: true,
        contextIsolation: true,
        webSecurity: true,
      },
    })
    let finished = false
    let loginPrepared = false
    let verifying = false
    let lastTry = 0
    const ticker = setInterval(() => { void verify() }, 6000)
    const finish = (success: boolean) => {
      if (finished) return
      finished = true
      clearInterval(ticker)
      ses.cookies.removeListener('changed', onCookieChanged)
      if (!win.isDestroyed()) win.close()
      resolve(success)
    }
    const verify = async () => {
      if (!loginPrepared || finished || verifying || Date.now() - lastTry < 3000) return
      lastTry = Date.now()
      verifying = true
      try {
        const credential = qqCredentialFromSession(await ses.cookies.get({}))
        if (!credential) return
        if (!win.isDestroyed()) win.setTitle('QQ 音乐 · 正在验证账号')
        await validateQQMusicCredential(credential)
        await writeAccountSecret('qqmusic', JSON.stringify(credential))
        updateSetting({ 'sync.qq.enable': true })
        finish(true)
        // A failed playlist fetch must not turn an authorized login into a
        // misleading 'login failed' notification; the sync worker owns retries.
        runWebDAVSyncTask(true)
      } catch {
        if (!win.isDestroyed()) win.setTitle('QQ 音乐 · 等待登录验证')
      } finally {
        verifying = false
      }
    }
    const onCookieChanged = (_event: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
      if (!removed && ['qm_keyst', 'qqmusic_key', 'uin', 'wxuin', 'musicid','qqmusic_uin'].includes(cookie.name)) void verify()
    }
    ses.cookies.on('changed', onCookieChanged)
    win.webContents.on('did-finish-load', () => { void verify() })
    win.webContents.on('did-navigate', () => { void verify() })
    win.webContents.on('did-navigate-in-page', () => { void verify() })
    win.on('closed', () => { finish(false) })
    // Never auto-accept a prior session when the user explicitly clicked
    // 登录. The vault is untouched if this re-login window is cancelled.
    void (async () => {
      try {
        await ses.clearStorageData({ storages: ['cookies', 'localstorage'] })
        if (finished) return
        loginPrepared = true
        await win.loadURL('https://y.qq.com/n/ryqq/profile')
      } catch (err) {
        if (finished) return
        finished = true
        clearInterval(ticker)
        ses.cookies.removeListener('changed', onCookieChanged)
        reject(new Error('QQ 音乐官方登录页面打开失败：' + (err as Error).message))
        if (!win.isDestroyed()) win.close()
      }
    })()
  }).finally(() => { pendingLogin = undefined })
  return pendingLogin
}
