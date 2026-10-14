import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getNeteaseAccountId } from '@any-listen/app/modules/sync'
import { BrowserWindow, safeStorage, session } from 'electron'

import { appState, updateSetting } from '@/app'

export const NETEASE_AUTH_PARTITION = 'persist:netease-auth'
const cookieFile = () => path.join(appState.dataPath, 'secrets', 'netease-session.bin')
const secureAvailable = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')

/** Keep raw credentials out of settings.json, WebDAV snapshots and the renderer. */
export const readSecureNeteaseCookie = async (): Promise<string> => {
  if (!secureAvailable()) return ''
  let ciphertext: Buffer
  try {
    ciphertext = await readFile(cookieFile())
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
  try {
    return safeStorage.decryptString(ciphertext)
  } catch {
    // Never remove a credential merely because the OS keychain is unavailable.
    return ''
  }
}
export const writeSecureNeteaseCookie = async (cookie: string): Promise<void> => {
  if (!secureAvailable()) throw new Error('系统安全凭据存储不可用；请解锁系统钥匙串后重试')
  const filename = cookieFile()
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  const tmp = filename + '.tmp'
  await writeFile(tmp, safeStorage.encryptString(cookie), { mode: 0o600 })
  await rename(tmp, filename)
}

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
    const finish = (ok: boolean) => {
      if (finished) return
      finished = true
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
      authSession.cookies.removeListener('changed', onCookiesChanged)
      reject(new Error('无法打开网易云官方登录网页：' + err.message))
      if (!win.isDestroyed()) win.close()
    })
  }).finally(() => {
    pendingLogin = undefined
  })
  return pendingLogin
}
