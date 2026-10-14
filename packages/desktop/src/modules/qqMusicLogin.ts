import { runWebDAVSyncTask } from '@any-listen/app/modules/sync'
import { validateQQMusicCredential, type QQMusicCredential } from '@any-listen/app/modules/sync/external/qqMusic'
import { BrowserWindow, session } from 'electron'

import { updateSetting } from '@/app'

import { accountVaultAvailable, writeAccountSecret } from './accountVault'

export const QQ_AUTH_PARTITION = 'persist:qqmusic-auth'

/** Read QQ Music's *own* cookies from Electron's isolated Chromium session. */
const parseCredential = (cookies: Electron.Cookie[]): QQMusicCredential | null => {
  const relevant = cookies.filter((item) => item.domain === 'qq.com' || item.domain?.endsWith('.qq.com'))
  const values = new Map(relevant.map((item) => [item.name, item.value]))
  const musicKey = values.get('qqmusic_key') || values.get('qm_keyst') || ''
  const rawId = values.get('musicid') || values.get('qqmusic_uin') || values.get('wxuin') || values.get('uin') || ''
  const musicId = rawId.replace(/^o/, '')
  if (!/^\d{4,20}$/.test(musicId) || !musicKey) return null
  return { musicId, musicKey }
}
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
      if (finished || verifying || Date.now() - lastTry < 3000) return
      lastTry = Date.now()
      verifying = true
      try {
        const credential = parseCredential(await ses.cookies.get({}))
        if (!credential) return
        await validateQQMusicCredential(credential)
        await writeAccountSecret('qqmusic', JSON.stringify(credential))
        updateSetting({ 'sync.qq.enable': true })
        runWebDAVSyncTask(true)
        finish(true)
      } catch {
        // The browser login may not have completed or may require another step.
      } finally {
        verifying = false
      }
    }
    const onCookieChanged = (_event: Electron.Event, cookie: Electron.Cookie) => {
      if (['qm_keyst', 'qqmusic_key', 'uin', 'wxuin', 'musicid'].includes(cookie.name)) void verify()
    }
    ses.cookies.on('changed', onCookieChanged)
    win.webContents.on('did-finish-load', () => { void verify() })
    win.webContents.on('did-navigate', () => { void verify() })
    win.on('closed', () => { finish(false) })
    void win.loadURL('https://y.qq.com/n/ryqq/profile').catch((err: Error) => {
      if (finished) return
      finished = true
      clearInterval(ticker)
      ses.cookies.removeListener('changed', onCookieChanged)
      reject(new Error('QQ 音乐官方登录页面打开失败：' + err.message))
      if (!win.isDestroyed()) win.close()
    })
  }).finally(() => { pendingLogin = undefined })
  return pendingLogin
}
