import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'

// NetEase's WEAPI scheme; this is not an official stable public API.
const publicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'
const iv = Buffer.from('0102030405060708')
const aes = (value: string, key: string) => {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key), iv)
  return Buffer.concat([cipher.update(value), cipher.final()]).toString('base64')
}
const encode = (payload: object) => {
  const secret = randomBytes(16).toString('hex').slice(0, 16)
  const padded = Buffer.alloc(128)
  Buffer.from(secret).reverse().copy(padded, 112)
  return new URLSearchParams({
    params: aes(aes(JSON.stringify(payload), '0CoJUm6Qyw8W8jud'), secret),
    encSecKey: publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, padded).toString('hex'),
  })
}

export interface NeteaseResponse {
  code: number
  message?: string
}

export const requestNetease = async <T extends NeteaseResponse>(
  route: string,
  cookie: string,
  payload: object
): Promise<{ body: T; setCookies: string[] }> => {
  if (!/^[a-z0-9/_-]+$/i.test(route)) throw new Error('Invalid NetEase API route')
  const csrf = cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] ?? ''
  const response = await fetch('https://music.163.com/weapi/' + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://music.163.com',
      Referer: 'https://music.163.com/',
      Cookie: cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
    },
    body: encode({ ...payload, csrf_token: csrf }),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error('NetEase HTTP ' + response.status)
  const body = await response.json() as T
  if (body.code !== 200) throw new Error('NetEase API returned code ' + body.code)
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  return { body, setCookies: headers.getSetCookie?.() ?? [] }
}

const validName = /^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/
/** Avoid logging, exposing, or serializing cookies as part of playlist metadata. */
export const readCookiePairs = (cookie: string): Map<string, string> => {
  const pairs = new Map<string, string>()
  for (const field of cookie.split(';')) {
    const i = field.indexOf('=')
    if (i < 1) continue
    const name = field.slice(0, i).trim()
    const value = field.slice(i + 1).trim()
    if (validName.test(name)) pairs.set(name, value)
  }
  return pairs
}
export const mergeSetCookies = (cookie: string, setCookies: string[]): string => {
  const pairs = readCookiePairs(cookie)
  for (const header of setCookies) {
    const first = header.split(';', 1)[0]
    const i = first.indexOf('=')
    if (i < 1) continue
    const name = first.slice(0, i).trim()
    const value = first.slice(i + 1).trim()
    if (!validName.test(name)) continue
    const maxAge = /(?:^|;)\s*max-age=(-?\d+)/i.exec(header)?.[1]
    const expires = /(?:^|;)\s*expires=([^;]+)/i.exec(header)?.[1]
    if (value === '' || (maxAge != null && Number(maxAge) <= 0) || (expires != null && Date.parse(expires) <= Date.now())) {
      pairs.delete(name)
    } else {
      pairs.set(name, value)
    }
  }
  return Array.from(pairs, ([name, value]) => name + '=' + value).join('; ')
}
export const getNeteaseAccountId = async (cookie: string): Promise<number> => {
  if (!readCookiePairs(cookie).get('MUSIC_U')) throw new Error('NetEase account not authenticated')
  const { body } = await requestNetease<{ code: number; account?: { id: number } }>('nuser/account/get', cookie, {})
  if (!body.account?.id) throw new Error('NetEase session expired')
  return body.account.id
}
/**
 * Only an existing authorized session can refresh. Never resubmit passwords,
 * SMS codes or captchas. Some QR logins are not refreshable.
 */
export const refreshNeteaseCookie = async (cookie: string): Promise<string> => {
  if (!readCookiePairs(cookie).get('MUSIC_U')) throw new Error('Missing authenticated NetEase cookie')
  const { setCookies } = await requestNetease('login/token/refresh', cookie, {})
  const updated = mergeSetCookies(cookie, setCookies)
  if (!readCookiePairs(updated).get('MUSIC_U')) throw new Error('NetEase refresh removed MUSIC_U')
  await getNeteaseAccountId(updated)
  return updated
}
