import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'
import { applyExternalMirrors, type MirrorPlaylist } from './mirror'

const publicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'
const iv = Buffer.from('0102030405060708')
const aes = (text: string, key: string) => {
  const c = createCipheriv('aes-128-cbc', Buffer.from(key), iv)
  return Buffer.concat([c.update(text), c.final()]).toString('base64')
}
const encode = (body: object) => {
  const secret = randomBytes(16).toString('hex').slice(0, 16)
  const padded = Buffer.alloc(128)
  Buffer.from(secret).reverse().copy(padded, 112)
  return new URLSearchParams({
    params: aes(aes(JSON.stringify(body), '0CoJUm6Qyw8W8jud'), secret),
    encSecKey: publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, padded).toString('hex'),
  })
}
const post = async <T extends { code: number; message?: string }>(route: string, cookie: string, body: object): Promise<T> => {
  const csrf = cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] ?? ''
  const response = await fetch('https://music.163.com/weapi/' + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://music.163.com',
      Referer: 'https://music.163.com/',
      Cookie: cookie,
      'User-Agent': 'Mozilla/5.0',
    },
    body: encode({ ...body, csrf_token: csrf }),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error('NetEase HTTP ' + response.status)
  const value = await response.json() as T
  if (value.code !== 200) throw new Error('NetEase API ' + value.code + ': ' + (value.message ?? ''))
  return value
}
interface Song {
  id: number
  name: string
  dt?: number
  ar?: Array<{ name: string }>
  al?: { id?: number; name?: string; picUrl?: string }
}
const convert = (s: Song): AnyListen.Music.MusicInfoOnline => ({
  id: 'wy_' + s.id,
  name: s.name,
  singer: s.ar?.map((a) => a.name).join('、') ?? '',
  interval: s.dt ? String(Math.floor(s.dt / 60000)).padStart(2, '0') + ':' + String(Math.floor(s.dt / 1000) % 60).padStart(2, '0') : null,
  isLocal: false,
  meta: {
    source: 'wy', musicId: String(s.id), albumName: s.al?.name ?? '',
    albumId: s.al?.id, picUrl: s.al?.picUrl, createTime: 0, updateTime: 0, posTime: 0,
  },
})
/** Account and daily recommendation read-only mirrors; never write back to NetEase. */
export const syncNeteaseAccount = async (cookie: string) => {
  if (!/(?:^|;\s*)MUSIC_U=/.test(cookie)) throw new Error('NetEase MUSIC_U cookie required')
  const account = await post<{ code: number; account?: { id: number } }>('nuser/account/get', cookie, {})
  if (!account.account?.id) throw new Error('NetEase login expired')
  const uid = account.account.id
  const playlists: Array<{ id: number; name: string }> = []
  for (let offset = 0; offset < 5000; offset += 200) {
    const page = await post<{ code: number; playlist: Array<{ id: number; name: string }> }>(
      'user/playlist', cookie, { uid, offset, limit: 200, total: true, includeVideo: true }
    )
    playlists.push(...page.playlist)
    if (page.playlist.length < 200) break
  }
  const mirrors: MirrorPlaylist[] = []
  for (const item of playlists) {
    const detail = await post<{ code: number; playlist?: { trackIds?: Array<{ id: number }> } }>(
      'v3/playlist/detail', cookie, { id: item.id, n: 100000, s: 8 }
    )
    const ids = detail.playlist?.trackIds?.map((track) => track.id) ?? []
    const songs: AnyListen.Music.MusicInfoOnline[] = []
    for (let i = 0; i < ids.length; i += 300) {
      const batch = ids.slice(i, i + 300)
      const data = await post<{ code: number; songs: Song[] }>(
        'v3/song/detail', cookie, { c: JSON.stringify(batch.map((id) => ({ id }))) }
      )
      const map = new Map(data.songs.map((s) => [s.id, s]))
      for (const id of batch) {
        const s = map.get(id)
        if (s) songs.push(convert(s))
      }
    }
    mirrors.push({ key: 'playlist:' + item.id, name: '网易云 · ' + item.name, list: songs })
  }
  const daily = await post<{ code: number; data?: { dailySongs?: Song[] } }>(
    'v3/discovery/recommend/songs', cookie, { offset: 0, total: true, limit: 30 }
  )
  if (daily.data?.dailySongs) {
    mirrors.push({ key: 'daily', name: '网易云 · 每日推荐', list: daily.data.dailySongs.map(convert) })
  }
  return applyExternalMirrors('netease:' + uid, mirrors)
}
