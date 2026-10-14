import { createHash, randomBytes } from 'node:crypto'

import { applyExternalMirrors, type MirrorPlaylist } from './mirror'

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
  options: { login?: boolean; router?: string } = {}
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
  const base = login ? 'https://login-user.kugou.com' : 'https://gateway.kugou.com'
  const query = new URLSearchParams(Object.entries({ ...data, signature }).map(([key, value]) => [key, str(value)]))
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
  const musicId = audioId || hash
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
    name: str(raw.songname ?? raw.ori_audio_name ?? raw.audio_name ?? raw.name) || '未命名歌曲',
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
    for (const raw of rows) {
      const song = convertKugouSong(asObj(raw))
      if (!song) throw new Error('酷狗歌曲缺少 hash，拒绝覆盖本地镜像')
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

export const readKugouPlaylists = async (account: KugouAccount): Promise<MirrorPlaylist[]> => {
  safeAccount(account)
  const list = await readPlaylistItems(account)
  const mirrors: MirrorPlaylist[] = []
  for (const item of list) {
    const songs = await readSongs(account, item.id)
    if (item.count > 0 && songs.length === 0) throw new Error('酷狗歌单非空但歌曲读取失败')
    mirrors.push({ key: 'playlist:' + item.id, name: '酷狗 · ' + item.name, list: songs })
  }
  return mirrors
}
export const syncKugouAccount = async (account: KugouAccount) =>
  applyExternalMirrors('kugou:' + account.userId, await readKugouPlaylists(account))
