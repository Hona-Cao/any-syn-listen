import { runWebDAVSyncTask } from '@any-listen/app/modules/sync'
import { checkKugouLoginQR, createKugouLoginQR } from '@any-listen/app/modules/sync/external/kugouMusic'
import { BrowserWindow } from 'electron'

import { updateSetting } from '@/app'

import { accountVaultAvailable, writeAccountSecret } from './accountVault'

let pendingLogin: Promise<boolean> | undefined

/**
 * Display the QR image returned from the provider in a sealed local window.
 * Only the official mobile app confirms the login; no password or SMS input.
 */
export const openKugouLoginWindow = (): Promise<boolean> => {
  if (pendingLogin) return pendingLogin
  if (!accountVaultAvailable()) return Promise.reject(new Error('系统安全凭据存储不可用，请先启用系统钥匙串'))
  pendingLogin = (async () => {
    const qr = await createKugouLoginQR()
    const window = new BrowserWindow({
      title: '酷狗音乐 · 扫码授权',
      width: 460, height: 560, resizable: false,
      webPreferences: {
        sandbox: true, nodeIntegration: false, contextIsolation: true,
        webSecurity: true,
      },
    })
    let closed = false
    window.on('closed', () => { closed = true })
    // QR content is restricted to a validated data:image/png URL.
    const html = [
      '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">',
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; style-src &#39;unsafe-inline&#39;">',
      '<style>body{font:16px system-ui;text-align:center;padding:25px;background:#181818;color:white}',
      'img{width:290px;height:290px;margin:24px auto;border:12px solid white;border-radius:12px}</style></head><body>',
      '<h2>酷狗音乐扫码登录</h2>',
      '<p>使用手机酷狗音乐扫描二维码并确认授权</p>',
      '<img alt="酷狗官方二维码" src="' + qr.image + '">',
      '<p>授权成功后窗口自动关闭；二维码约三分钟过期</p></body></html>',
    ].join('')
    try {
      await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      while (!closed && Date.now() < qr.expiresAt) {
        const status = await checkKugouLoginQR(qr)
        if (status.status === 'connected' && status.account) {
          await writeAccountSecret('kugou', JSON.stringify(status.account))
          updateSetting({ 'sync.kugou.enable': true })
          runWebDAVSyncTask(true)
          if (!window.isDestroyed()) window.close()
          return true
        }
        if (status.status === 'expired') break
        await new Promise((done) => setTimeout(done, 5000))
      }
      if (!window.isDestroyed()) window.close()
      return false
    } catch (err) {
      if (!window.isDestroyed()) window.close()
      throw new Error('酷狗登录失败：' + (err as Error).message)
    }
  })().finally(() => { pendingLogin = undefined })
  return pendingLogin
}
