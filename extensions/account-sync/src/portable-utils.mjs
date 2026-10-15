// Cross-platform AnyListen extension transport. All requests are made through the
// official API's internet grant; no localhost server or companion executable.
export function parseEndpoint(value) {
  // The official AnyListen extension isolate does not expose global URL.
  const match=/^(https?):\/\/([^/?#]+)([^#]*)$/i.exec(String(value))
  if(!match)throw new Error('URL 地址格式错误')
  const authority=match[2].toLowerCase()
  if(/[@\\%]/.test(authority))throw new Error('URL 不允许包含账号或编码主机名')
  const host=authority.replace(/:\d{1,5}$/,'')
  if(!/^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])$/.test(host))throw new Error('主机名格式错误')
  const protocol=match[1].toLowerCase()+':'
  return {protocol,hostname:host,authority,path:match[3]||'/',href:String(value)}
}
export const encodeQuery = (params) => Object.entries(params).map(([key,value]) =>
  encodeURIComponent(key)+'='+encodeURIComponent(String(value))
).join('&')

export const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
export const asObject = (v) => isObject(v) ? v : {}
export const stringOf = (v) => typeof v === 'string' || typeof v === 'number' ? String(v) : ''
export const onlyDigits = (v) => /^\d{1,20}$/.test(String(v ?? ''))
export const songDuration = (seconds) => {
  const n = Number(seconds)
  return Number.isFinite(n) && n > 0
    ? String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(Math.floor(n % 60)).padStart(2, '0')
    : null
}
export const cleanMessage = (err) => String(err?.message ?? err ?? '请求失败')
  .replace(/(MUSIC_U|musickey|refresh_token|token|password|authorization)[=:]\s*[^;\s,]+/ig, '$1=[hidden]')
  .slice(0, 180)

const toJSON = (body) => {
  if (typeof body !== 'string') return body
  try { return JSON.parse(body) } catch { return body }
}
export async function platformRequest(api, url, opts = {}) {
  const parsed = parseEndpoint(url)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1','localhost'].includes(parsed.hostname))) {
    throw new Error('仅支持 HTTPS 请求')
  }
  // Explicit allowlist prevents sending credential headers to arbitrary URLs.
  const host = parsed.hostname
  const allowed = ['music.163.com','interface.music.163.com','u.y.qq.com',
    'c6.y.qq.com','open.weixin.qq.com','lp.open.weixin.qq.com',
    'gateway.kugou.com','login-user.kugou.com','loginserviceretry.kugou.com']
  if (!allowed.includes(host) && !opts.externalDav) throw new Error('不支持的音乐平台地址')
  if (opts.externalDav && parsed.authority.includes('@')) throw new Error('WebDAV 地址不能包含账号密码')
  let resp
  try {
    const { externalDav: _, ...requestOptions } = opts
    resp = await api.request(url, { timeout: 25000, maxRedirect: 0, ...requestOptions })
  } catch {
    throw new Error((opts.externalDav ? 'WebDAV' : '音乐平台') + '网络请求失败')
  }
  const code = Number(resp?.statusCode ?? 0)
  if (code < 200 || code >= 300) throw new Error((opts.externalDav ? 'WebDAV' : '平台') + ' HTTP ' + code)
  return { body: toJSON(resp.body), headers: resp.headers ?? {}, raw: resp.raw }
}
export function cookiePairs(cookie = '') {
  const result = new Map()
  for (const field of String(cookie).split(';')) {
    const i = field.indexOf('=')
    if (i <= 0) continue
    const name = field.slice(0,i).trim(), value = field.slice(i+1).trim()
    if (/^[!#$%&'*+.^_\x60|~0-9a-zA-Z-]+$/.test(name)) result.set(name, value)
  }
  return result
}
const setCookieLines = (value) => {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  // A Set-Cookie Expires attribute contains commas; split only at next NAME=.
  return value.split(/,(?=\s*[!#$%&'*+.^_\x60|~0-9a-zA-Z-]+=)/g)
}
export function mergeCookies(cookie, responseHeaders) {
  const pairs = cookiePairs(cookie)
  const headers = Object.entries(responseHeaders || {})
    .filter(([k]) => k.toLowerCase() === 'set-cookie')
    .flatMap(([,v]) => setCookieLines(v))
  for (const line of headers) {
    const first = line.split(';',1)[0], i = first.indexOf('=')
    if (i < 1) continue
    const name = first.slice(0,i).trim(), value = first.slice(i+1).trim()
    const age = /(?:^|;)\s*max-age=(-?\d+)/i.exec(line)?.[1]
    if (!/^[!#$%&'*+.^_\x60|~0-9a-zA-Z-]+$/.test(name)) continue
    if (!value || (age != null && Number(age) <= 0)) pairs.delete(name)
    else pairs.set(name,value)
  }
  return [...pairs].map(([k,v]) => k + '=' + v).join('; ')
}
export async function sha256(api, text) {
  const val = await api.utils.crypto.sha256(String(text))
  return typeof val === 'string' ? val : await api.utils.dataConverter(val, 'hex')
}
export async function md5(api, text) {
  const val = await api.utils.crypto.md5(String(text))
  return typeof val === 'string' ? val : await api.utils.dataConverter(val, 'hex')
}
export async function basicAuthorization(api, username, password) {
  return 'Basic ' + await api.utils.dataConverter(username + ':' + password, 'utf-8', 'base64')
}
export const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
