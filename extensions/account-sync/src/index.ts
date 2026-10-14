import { SyncEngine } from './engine.mjs'
const api = require('any-listen')
const ENDPOINT = 'http://127.0.0.1:38481'
let connection: { token: string; clientId: string } | undefined
let engine: SyncEngine | undefined
let busy = false
async function connect() {
  const code = String((await api.app.showInputDialog({ title: '连接账号助手', placeholder: '输入助手显示的 8 位连接码' })) ?? '').trim()
  if (!/^\d{8}$/.test(code)) return
  const response = await api.request(ENDPOINT + '/v1/pair', { method: 'POST', json: { code }, timeout: 5000, maxRedirect: 0 })
  if (response.statusCode !== 200 || !response.body?.token) throw new Error('连接码无效或已过期')
  connection = { token: response.body.token, clientId: response.body.clientId }
  await api.storage.writeFile('connection.json', JSON.stringify(connection))
  await initialize(); await tick()
  await api.app.showMessage('连接成功')
}
async function transport(payload: unknown) {
  if (!connection) throw new Error('尚未连接')
  const response = await api.request(ENDPOINT + '/v1/poll', { method: 'POST', headers: { Authorization: 'Bearer ' + connection.token }, json: { clientId: connection.clientId, ...(payload as object) }, timeout: 20000, maxRedirect: 0 })
  if (response.statusCode !== 200) throw new Error('账号助手未连接')
  return response.body
}
async function initialize() {
  if (engine || !connection) return
  if (!api.musicList || !api.request) throw new Error('请授权网络及歌单访问')
  engine = new SyncEngine(api, transport)
  await engine.load()
  api.musicList.onListAction((event: unknown) => { void engine?.onExternalAction(event).catch(() => {}) })
}
async function tick() {
  if (busy || !connection) return
  busy = true
  try { await initialize(); await engine?.cycle() } catch { /* Quiet reconnect; detailed status lives in the helper. */ }
  finally { busy = false }
}
async function main() {
  await api.command.registerCommand('connect', connect)
  await api.command.registerCommand('sync', async () => {
    if (!connection) return connect()
    const r = await api.request(ENDPOINT + '/v1/refresh', { method: 'POST', headers: { Authorization: 'Bearer ' + connection.token }, json: {}, timeout: 5000, maxRedirect: 0 })
    if (r.statusCode !== 200) throw new Error('请先打开账号助手')
    await tick()
  })
  await api.command.registerCommand('manage', async () => {
    if (!connection) return connect()
    const response = await api.request(ENDPOINT + '/v1/open', { method: 'POST', headers: { Authorization: 'Bearer ' + connection.token }, json: {}, timeout: 5000, maxRedirect: 0 })
    if (response.statusCode !== 200) throw new Error('请先打开账号助手')
  })
  if (await api.storage.fileExists('connection.json')) connection = JSON.parse(await api.storage.readFile('connection.json', 'utf-8'))
  await tick()
  setInterval(() => { void tick() }, 4000)
}
void main().catch(() => api.logcat.error('账号同步扩展初始化失败'))
