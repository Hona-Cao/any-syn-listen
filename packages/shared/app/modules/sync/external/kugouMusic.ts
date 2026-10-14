import { constants, createCipheriv, createDecipheriv, createHash, publicEncrypt, randomBytes } from 'node:crypto'

import type { MirrorPlaylist } from './mirror'

/**
 * Read-only first-party Kugou gateway client. Endpoint shapes are based on
 * MakcRe/KuGouMusicApi and Nshpiter/Q-music's verified account reader.
 * No third-party API server is involved. Server API may change.
 */
export interface KugouAccount {
  userId: string
  token: string
  mid: string
}
export interface KugouLoginQR {
  key: string
  url: string
  image: string
  mid: string
  expiresAt: number
}
interface Row { [key: string]: unknown }
const asObj = (x: unknown): Row => x && typeof x === 'object' && !Array.isArray(x) ? x as Row : {}
const str = (x: unknown) => typeof x === 'string' || typeof x === 'number' ? String(x) : ''
const md5 = (x: string) => createHash('md5').update(x).digest('hex')
const safeAccount = (a: KugouAccount) => {
  if (!/^\d{1,20}$/.test(a.userId) || !a.userId.replace(/0/g, '').length ||
      !a.token || a.token.length > 4096 || !/^[a-f0-9]{32}$/i.test(a.mid)) {
    throw new Error('酷狗登录状态不完整，需重新授权')
  }
}
const numeric = (x: unknown) => /^\d{1,20}$/.test(str(x)) && Number(x) > 0 ? str(x) : ''
const md5Hash = (x: unknown) => /^[A-F\d]{32}$/i.test(str(x)) ? str(x).toUpperCase() : ''
const sizeStr = (x: unknown) => Number(x) > 0 ? (Number(x) / 1048576).toFixed(2) + ' MB' : null

const requestGateway = async (
  path: string,
  mid: string,
  params: Row,
  body?: Row,
  options: { login?: boolean; router?: string; baseUrl?: string } = {}
): Promise<Row> => {
  if (!/^\/[a-z0-9/_-]+$/i.test(path)) throw new Error('Unsafe Kugou route')
  if (!/^[a-f0-9]{32}$/i.test(mid)) throw new Error('Kugou device id invalid')
  const login = options.login ?? false
  const data: Row = {
    dfid: '-',
    mid,
    uuid: '-',
    appid: 1005,
    clientver: 20489,
    clienttime: Math.floor(Date.now() / 1000),
    ...params,
  }
  const json = body ? JSON.stringify(body) : ''
  const salt = login ? 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt' : 'OIlwieks28dk2k092lksi2UIkp'
  const signed = Object.keys(data).sort().map((key) => key + '=' + str(data[key])).join('')
  const signature = md5(salt + signed + json + salt)
  const base = options.baseUrl ?? (login ? 'https://login-user.kugou.com' : 'https://gateway.kugou.com')
  const query = new URLSearchParams(Object.entries({ ...data, signature }).map(([key, value]): [string, string] => [key, str(value)]))
  let response: Response
  try {
    response = await fetch(base + path + '?' + query.toString(), {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        mid,
        dfid: '-',
        clienttime: str(data.clienttime),
        ...(login ? {} : { 'x-router': options.router ?? 'cloudlist.service.kugou.com' }),
      },
      ...(body ? { body: json } : {}),
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    // Do not log the signed URL: it may contain an authentication token.
    throw new Error('酷狗网络请求失败')
  }
  if (!response.ok) throw new Error('酷狗接口 HTTP ' + response.status)
  const result = await response.json() as Row
  if (Number(result.status) !== 1 || (result.error_code != null && Number(result.error_code) !== 0)) {
    throw new Error('酷狗接口拒绝请求（可能需要重新登录）')
  }
  return asObj(result.data)
}

// Kugou's phone verification protocol, based on KuGouMusicApi's login_cellphone
// and captcha_sent modules. The mobile number and code are never persisted.
const kgRsaPublicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB\n-----END PUBLIC KEY-----'
const md5Text = (text: string) => createHash('md5').update(text).digest('hex')
const aesKey = (secret: string) => Buffer.from(md5Text(secret).slice(0, 32), 'utf8')
const aesIv = (secret: string) => Buffer.from(md5Text(secret).slice(-16), 'utf8')
const kgEncrypt = (text: string, secret: string): string => {
  const cipher = createCipheriv('aes-256-cbc', aesKey(secret), aesIv(secret))
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('hex')
}
const kgDecrypt = (hex: string, secret: string): string => {
  const decipher = createDecipheriv('aes-256-cbc', aesKey(secret), aesIv(secret))
  return Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()]).toString('utf8')
}
const kgRawRsa = (text: string): string => {
  const source = Buffer.from(text, 'utf8')
  const block = Buffer.alloc(128)
  if (source.length > block.length) throw new Error('Kugou phone authentication payload too large')
  source.copy(block)
  return publicEncrypt({ key: kgRsaPublicKey, padding: constants.RSA_NO_PADDING }, block).toString('hex').toUpperCase()
}
const kgPhoneStates = new Map<string, { mid: string; sentAt: number; expiresAt: number }>()
const validPhone = (phone: string) => {
  if (!/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确')
}
export const sendKugouPhoneCode = async (phone: string): Promise<void> => {
  validPhone(phone)
  const prev = kgPhoneStates.get(phone)
  const now = Date.now()
  if (prev && now - prev.sentAt < 60_000) throw new Error('请稍后再获取验证码')
  const mid = prev?.mid ?? randomBytes(16).toString('hex')
  // Send from the application only after an explicit button click. Never use HTTP.
  const response = await requestGateway('/v7/send_mobile_code', mid, {}, {
    businessid: 5, mobile: phone, plat: 3,
  }, { baseUrl: 'https://login.user.kugou.com' })
  if (Number(response.status) === 0) throw new Error('验证码发送失败')
  kgPhoneStates.set(phone, { mid, sentAt: now, expiresAt: now + 5 * 60_000 })
}
export const loginKugouWithPhoneCode = async (phone: string, code: string): Promise<KugouAccount> => {
  validPhone(phone)
  if (!/^\d{4,8}$/.test(code)) throw new Error('验证码格式不正确')
  const state = kgPhoneStates.get(phone)
  if (!state || Date.now() > state.expiresAt) throw new Error('验证码已过期，请重新获取')
  const now = Date.now()
  const secret = randomBytes(8).toString('hex')
  const encrypted = kgEncrypt(JSON.stringify({ mobile: phone, code }), secret)
  const payload = {
    plat: 1,
    support_multi: 1,
    t1: 0, t2: 0, t3: 'MCwwLDAsMCwwLDAsMCwwLDA=',
    clienttime_ms: now,
    mobile: phone.slice(0, 2) + '*****' + phone.slice(-1),
    key: md5Text('1005' + 'OIlwieks28dk2k092lksi2UIkp' + '20489' + now),
    pk: kgRawRsa(JSON.stringify({ clienttime_ms: now, key: secret })),
    params: encrypted,
  }
  const result = await requestGateway('/v7/login_by_verifycode', state.mid, {}, payload, {
    baseUrl: 'https://loginserviceretry.kugou.com',
  })
  let data = result
  if (typeof result.secu_params === 'string' && result.secu_params) {
    const parsed: unknown = JSON.parse(kgDecrypt(result.secu_params, secret))
    if (typeof parsed === 'string') data = { ...result, token: parsed }
    else if (parsed && typeof parsed === 'object') data = { ...result, ...parsed }
  }
  const account: KugouAccount = {
    userId: str(data.userid ?? data.user_id),
    token: str(data.token),
    mid: state.mid,
  }
  safeAccount(account)
  kgPhoneStates.delete(phone)
  return account
}

export const createKugouLoginQR = async (): Promise<KugouLoginQR> => {
  const mid = randomBytes(16).toString('hex')
  const data = await requestGateway('/v2/qrcode', mid, {
    type: 1,
    plat: 4,
    srcappid: 2919,
    qrcode_txt: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1005&',
  }, undefined, { login: true })
  const key = str(data.qrcode)
  const image = str(data.qrcode_img)
  if (!/^[\w-]{8,300}$/.test(key) ||
      !/^(?:data:image\/png;base64,)?[a-zA-Z\d+/=]{100,}$/.test(image)) {
    throw new Error('酷狗没有返回有效登录二维码')
  }
  return {
    mid,
    key,
    image: image.startsWith('data:') ? image : 'data:image/png;base64,' + image,
    url: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=' + encodeURIComponent(key),
    expiresAt: Date.now() + 180000,
  }
}

export const checkKugouLoginQR = async (
  qr: KugouLoginQR
): Promise<{ status: 'waiting' | 'scanned' | 'expired' | 'connected'; account?: KugouAccount }> => {
  if (Date.now() >= qr.expiresAt) return { status: 'expired' }
  const data = await requestGateway('/v2/get_userinfo_qrcode', qr.mid, {
    plat: 4, srcappid: 2919, qrcode: qr.key,
  }, undefined, { login: true })
  const state = Number(data.status)
  if (state === 0) return { status: 'expired' }
  if (state === 1) return { status: 'waiting' }
  if (state === 2) return { status: 'scanned' }
  if (state !== 4) throw new Error('酷狗二维码返回未知状态')
  const account = { userId: str(data.userid), token: str(data.token), mid: qr.mid }
  safeAccount(account)
  return { status: 'connected', account }
}

export const convertKugouSong = (raw: Row): AnyListen.Music.MusicInfoOnline | null => {
  const hash = md5Hash(raw.hash ?? raw.filehash ?? raw.file_hash ?? asObj(raw.audio_info).hash)
  if (!hash) return null
  const info = asObj(raw.audio_info)
  const album = asObj(raw.album_info)
  const audioId = numeric(info.audio_id ?? raw.audio_id ?? raw.audioid ?? raw.album_audio_id)
  const title = str(raw.songname ?? raw.ori_audio_name ?? raw.audio_name ?? raw.name)
  if (!audioId || !title) return null
  const musicId = audioId
  const seconds = Number(info.timelength ?? raw.timelength ?? 0) / 1000
  const qualitys: AnyListen.Music.MusicQualityType = {
    '128k': { sizeStr: sizeStr(info.filesize ?? raw.filesize), hash },
  }
  const options = [
    ['320k', info.hash_320 ?? raw.hash_320, info.filesize_320 ?? raw.filesize_320],
    ['flac', info.hash_flac ?? raw.hash_flac, info.filesize_flac ?? raw.filesize_flac],
    ['flac24bit', info.hash_high ?? raw.hash_high, info.filesize_high ?? raw.filesize_high],
  ] as const
  for (const [quality, fileHash, length] of options) {
    const h = md5Hash(fileHash)
    if (h) qualitys[quality] = { sizeStr: sizeStr(length), hash: h }
  }
  return {
    id: 'kg_' + musicId + '_' + hash,
    name: title,
    singer: str(raw.author_name ?? raw.singername ?? raw.singer),
    interval: seconds > 0 && Number.isFinite(seconds)
      ? String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(Math.floor(seconds % 60)).padStart(2, '0')
      : null,
    isLocal: false,
    meta: {
      source: 'kg',
      musicId,
      hash,
      albumAudioId: numeric(info.audio_group_id ?? raw.album_audio_id),
      albumId: numeric(album.album_id ?? raw.album_id),
      albumName: str(album.album_name ?? raw.album_name),
      qualitys,
      createTime: 0,
      updateTime: 0,
      posTime: 0,
    },
  }
}
/**
 * Cloudlist occasionally returns only the file hash. Use the same read-only
 * public detail endpoint as AnyListen's Online Metadata extension to fill
 * audio_id/title and preserve playable KG song IDs. Do not mirror placeholders.
 */
const fillMissingKugouMetadata = async (rows: Row[]): Promise<Row[]> => {
  const missing: Array<{ index: number; hash: string }> = []
  rows.forEach((row, index) => {
    const info = asObj(row.audio_info)
    const songId = numeric(info.audio_id ?? row.audio_id ?? row.audioid ?? row.album_audio_id)
    const name = str(row.songname ?? row.ori_audio_name ?? row.audio_name ?? row.name)
    if (songId && name) return
    const hash = md5Hash(row.hash ?? row.filehash ?? row.file_hash)
    if (!hash) throw new Error('酷狗云端歌曲缺少有效 hash')
    missing.push({ index, hash })
  })
  for (let start = 0; start < missing.length; start += 100) {
    const batch = missing.slice(start, start + 100)
    const response = await fetch('https://gateway.kugou.com/v2/album_audio/audio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'KG-THash': '13a3164',
        'KG-RC': '1',
        'KG-Fake': '0',
        'KG-RF': '00869891',
        'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
        'x-router': 'kmr.service.kugou.com',
      },
      body: JSON.stringify({
        area_code: '1', show_privilege: 1, show_album_info: '1',
        is_publish: '', appid: 1005, clientver: 11451,
        mid: '1', dfid: '-', clienttime: Date.now(),
        key: 'OIlwieks28dk2k092lksi2UIkp',
        fields: 'album_info,author_name,audio_info,ori_audio_name,base,songname',
        data: batch.map(({ hash }) => ({ hash })),
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error('酷狗歌曲元数据请求失败：' + response.status)
    const body = await response.json() as { error_code?: number; data?: unknown[] }
    if (body.error_code !== 0 || !Array.isArray(body.data) || body.data.length !== batch.length) {
      throw new Error('酷狗歌曲元数据返回不完整')
    }
    batch.forEach(({ index }, j) => {
      const detail = body.data?.[j]
      const candidate = Array.isArray(detail) ? detail[0] : undefined
      const info = asObj(candidate)
      if (!Object.keys(info).length) throw new Error('酷狗歌曲详情缺失，保持本地镜像不变')
      rows[index] = {
        ...rows[index],
        ...info,
        hash: batch[j].hash,
        audio_info: { ...asObj(rows[index].audio_info), ...asObj(info.audio_info) },
      }
    })
  }
  return rows
}

interface PlaylistItem { id: string; name: string; count: number }
const readPlaylistItems = async (account: KugouAccount): Promise<PlaylistItem[]> => {
  const PAGE = 100
  const lists: PlaylistItem[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= 100; page++) {
    const data = await requestGateway('/v7/get_all_list', account.mid, {
      plat: 1, userid: account.userId, token: account.token,
    }, {
      userid: account.userId, token: account.token, total_ver: 979, type: 2, page, pagesize: PAGE,
    })
    const rows = data.info ?? data.list
    if (!Array.isArray(rows)) throw new Error('酷狗歌单目录数据不完整')
    for (const raw of rows) {
      const row = asObj(raw)
      const id = numeric(row.listid ?? row.list_id)
      if (!id || seen.has(id)) throw new Error('酷狗歌单目录出现重复或无效 ID')
      seen.add(id)
      lists.push({
        id,
        name: str(row.name ?? row.listname) || '未命名歌单',
        count: Number(row.count ?? row.songcount ?? row.filecount ?? 0),
      })
    }
    const total = Number(data.total ?? data.count)
    if (Number.isInteger(total) && total >= 0) {
      if (lists.length > total) throw new Error('酷狗歌单目录计数不一致')
      if (lists.length === total) return lists
      if (!rows.length) throw new Error('酷狗歌单目录分页不完整')
    } else if (rows.length < PAGE) return lists
  }
  throw new Error('酷狗歌单目录超过分页安全上限')
}

const readSongs = async (account: KugouAccount, id: string): Promise<AnyListen.Music.MusicInfoOnline[]> => {
  const PAGE = 300
  const songs: AnyListen.Music.MusicInfoOnline[] = []
  const seenPages = new Set<string>()
  let expected: number | null = null
  for (let page = 1; page <= 100; page++) {
    const data = await requestGateway('/v4/get_list_all_file_v3', account.mid, {
      userid: account.userId, token: account.token,
    }, {
      listid: id, userid: account.userId, token: account.token,
      type: 0, page, pagesize: PAGE, area_code: 1, allplatform: 1, show_cover: 1,
    })
    const rows = data.info ?? data.list
    if (!Array.isArray(rows)) throw new Error('酷狗歌单歌曲数据不完整')
    if (rows.length) {
      const pageKey = md5(JSON.stringify(rows.map((x) => asObj(x).hash ?? asObj(x).filehash)))
      if (seenPages.has(pageKey)) throw new Error('酷狗接口重复返回同一页')
      seenPages.add(pageKey)
    }
    if (data.count != null || data.total != null) {
      const total = Number(data.count ?? data.total)
      if (!Number.isInteger(total) || total < 0 || (expected != null && expected !== total)) {
        throw new Error('酷狗歌曲总数不一致')
      }
      expected = total
    }
    for (const raw of await fillMissingKugouMetadata(rows.map(asObj))) {
      const song = convertKugouSong(raw)
      if (!song) throw new Error('酷狗歌曲无法解析，拒绝覆盖本地镜像')
      songs.push(song)
    }
    if (expected != null && songs.length >= expected) {
      if (songs.length !== expected) throw new Error('酷狗歌曲分页数量不匹配')
      return songs
    }
    if (!rows.length || (expected == null && rows.length < PAGE)) {
      if (expected != null && songs.length !== expected) throw new Error('酷狗歌曲列表缺页')
      return songs
    }
  }
  throw new Error('酷狗歌曲分页超过安全上限')
}

const readKugouDaily = async (account: KugouAccount): Promise<MirrorPlaylist | null> => {
  const data = await requestGateway('/everyday_song_recommend', account.mid, {
    token: account.token, userid: account.userId,
  }, {
    platform: 'android', userid: account.userId,
  }, { router: 'everydayrec.service.kugou.com' })
  const nested = asObj(data.data)
  const rows = [data.info, data.list, data.songs, data.songlist, data.song_list,
    nested.info, nested.list, nested.songs, nested.song_list].find(Array.isArray)
  if (!Array.isArray(rows) || !rows.length) return null
  const songs: AnyListen.Music.MusicInfoOnline[] = []
  for (const item of await fillMissingKugouMetadata(rows.map(asObj))) {
    const song = convertKugouSong(item)
    if (song) songs.push(song)
  }
  if (!songs.length) return null
  return { key: 'daily', name: '酷狗·每日推荐', list: songs }
}

export const readKugouPlaylists = async (account: KugouAccount): Promise<MirrorPlaylist[]> => {
  safeAccount(account)
  const list = await readPlaylistItems(account)
  const mirrors: MirrorPlaylist[] = []
  for (const item of list) {
    const songs = await readSongs(account, item.id)
    if (item.count > 0 && songs.length === 0) throw new Error('酷狗歌单非空但歌曲读取失败')
    const loved = /^(?:我喜欢|我的喜欢|我收藏的音乐|喜欢的音乐)$/.test(item.name.trim())
    mirrors.push({ key: loved ? 'love' : 'playlist:' + item.id, name: loved ? '酷狗·我喜欢' : '酷狗·' + item.name, list: songs })
  }
  try {
    const daily = await readKugouDaily(account)
    if (daily) mirrors.push(daily)
  } catch {
    console.warn('[Kugou] Daily recommendations unavailable; account playlists were kept')
  }
  return mirrors
}
export const syncKugouAccount = async (account: KugouAccount) => {
  const playlists = await readKugouPlaylists(account)
  const { applyExternalMirrors } = await import('./mirror')
  return applyExternalMirrors('kugou:' + account.userId, playlists)
}
