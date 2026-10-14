import { applyExternalMirrors, type MirrorPlaylist } from './mirror'

/**
 * QQ Music read-only account adapter. Request format follows qqmusic-api and
 * QQMusicApi's GetPlaylistByUin/CgiGetDiss implementations.
 * Do not write or modify the remote user's favorites or playlists.
 */
export interface QQMusicCredential {
  musicId: string
  musicKey: string
}
interface QQSong {
  id?: number
  mid?: string
  name?: string
  title?: string
  interval?: number
  singer?: Array<{ name: string }>
  album?: { name?: string; mid?: string }
  file?: {
    media_mid?: string
    size_128mp3?: number
    size_320mp3?: number
    size_flac?: number
    size_hires?: number
  }
}
interface QQPlaylist {
  tid?: number
  dirId?: number
  dirName?: string
  name?: string
  songNum?: number
}
const required = (credential: QQMusicCredential) => {
  if (!/^\d{4,20}$/.test(credential.musicId) ||
      !credential.musicKey || credential.musicKey.length > 2048) {
    throw new Error('QQ 音乐账号缺少有效的 musicid / musickey')
  }
}
const buildComm = (credential: QQMusicCredential) => ({
  cv: 4747474,
  v: 4747474,
  ct: 11,
  tmeAppID: 'qqmusic',
  format: 'json',
  inCharset: 'utf-8',
  outCharset: 'utf-8',
  uid: credential.musicId,
  qq: credential.musicId,
  authst: credential.musicKey,
  tmeLoginType: credential.musicKey.startsWith('W_X') ? '1' : '2',
  loginUin: credential.musicId,
})
const requestQQ = async <T>(
  credential: QQMusicCredential,
  key: string,
  module: string,
  method: string,
  param: object
): Promise<T> => {
  required(credential)
  const request = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://y.qq.com',
      Referer: 'https://y.qq.com/',
      Cookie: [
        'uin=' + credential.musicId,
        'qqmusic_key=' + credential.musicKey,
        'qm_keyst=' + credential.musicKey,
        'tmeLoginType=' + (credential.musicKey.startsWith('W_X') ? '1' : '2'),
      ].join('; '),
    },
    body: JSON.stringify({
      comm: buildComm(credential),
      [key]: { method, module, param },
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!request.ok) throw new Error('QQ Music HTTP ' + request.status)
  const body = await request.json() as Record<string, unknown>
  if (body.code != null && body.code !== 0) throw new Error('QQ Music request rejected: ' + body.code)
  const result = body[key] as { code?: number; data?: T } | undefined
  if (!result || result.code !== 0 || result.data == null) {
    throw new Error('QQ Music account API returned incomplete data')
  }
  return result.data
}

export const convertQQSong = (song: QQSong): AnyListen.Music.MusicInfoOnline | null => {
  const mid = song.mid
  if (typeof mid !== 'string' || !mid || !(song.title || song.name)) return null
  const qualitys: AnyListen.Music.MusicQualityType = {}
  const sizeStr = (size?: number) => size && size > 0 ? (size / 1048576).toFixed(2) + ' MB' : null
  if (song.file?.size_128mp3) qualitys['128k'] = { sizeStr: sizeStr(song.file.size_128mp3) }
  if (song.file?.size_320mp3) qualitys['320k'] = { sizeStr: sizeStr(song.file.size_320mp3) }
  if (song.file?.size_flac) qualitys.flac = { sizeStr: sizeStr(song.file.size_flac) }
  if (song.file?.size_hires) qualitys.flac24bit = { sizeStr: sizeStr(song.file.size_hires) }
  const secs = song.interval
  const albumMid = song.album?.mid ?? ''
  return {
    id: 'tx_' + mid,
    name: song.title ?? song.name ?? '',
    singer: song.singer?.map((s) => s.name).join('、') ?? '',
    interval: typeof secs === 'number'
      ? String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0')
      : null,
    isLocal: false,
    meta: {
      source: 'tx',
      musicId: mid,
      songId: String(song.id ?? ''),
      albumName: song.album?.name ?? '',
      albumId: albumMid,
      albumMid,
      strMediaMid: song.file?.media_mid ?? '',
      picUrl: albumMid ? 'https://y.gtimg.cn/music/photo_new/T002R500x500M000' + albumMid + '.jpg' : '',
      qualitys,
      createTime: 0,
      updateTime: 0,
      posTime: 0,
    },
  }
}

const details = async (
  credential: QQMusicCredential,
  dissId: number,
  dirId: number,
  encryptedUin = ''
): Promise<AnyListen.Music.MusicInfoOnline[]> => {
  const songs: AnyListen.Music.MusicInfoOnline[] = []
  const PAGE_SIZE = 200
  let expected: number | undefined
  for (let page = 0; page < 100; page++) {
    const data = await requestQQ<{
      songlist?: QQSong[]
      total_song_num?: number
      hasmore?: boolean
    }>(credential, 'music.srfDissInfo.DissInfo', 'music.srfDissInfo.DissInfo', 'CgiGetDiss', {
      disstid: dissId,
      dirid: dirId,
      tag: true,
      song_begin: page * PAGE_SIZE,
      song_num: PAGE_SIZE,
      userinfo: true,
      orderlist: true,
      onlysonglist: false,
      ...(encryptedUin ? { enc_host_uin: encryptedUin } : {}),
    })
    if (!Array.isArray(data.songlist)) throw new Error('QQ Music playlist missing songlist')
    if (typeof data.total_song_num === 'number') expected = data.total_song_num
    const pageSongs = data.songlist.map(convertQQSong)
    // Missing song IDs would silently truncate the user's list. Refuse overwrite.
    if (pageSongs.some((s) => s === null)) throw new Error('QQ Music playlist contains unrecognized tracks')
    songs.push(...pageSongs as AnyListen.Music.MusicInfoOnline[])
    if (expected != null && songs.length >= expected) {
      if (songs.length !== expected) throw new Error('QQ Music song count does not match')
      return songs
    }
    if (!data.songlist.length || (expected == null && data.songlist.length < PAGE_SIZE)) return songs
  }
  throw new Error('QQ Music playlist exceeds pagination safety limit')
}

const encryptedUin = async (credential: QQMusicCredential): Promise<string> => {
  const url = new URL('https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg')
  url.searchParams.set('ct', '20')
  url.searchParams.set('cv', '4747474')
  url.searchParams.set('cid', '205360838')
  url.searchParams.set('userid', credential.musicId)
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!resp.ok) return ''
  const body = await resp.json() as { data?: { creator?: { encrypt_uin?: string } } }
  return body.data?.creator?.encrypt_uin ?? ''
}
export const readQQMusicPlaylists = async (credential: QQMusicCredential): Promise<MirrorPlaylist[]> => {
  const data = await requestQQ<{ v_playlist?: QQPlaylist[] }>(
    credential, 'music.musicasset.PlaylistBaseRead', 'music.musicasset.PlaylistBaseRead',
    'GetPlaylistByUin', { uin: credential.musicId }
  )
  if (!Array.isArray(data.v_playlist)) throw new Error('QQ Music user playlists missing')
  const lists: MirrorPlaylist[] = []
  const seen = new Set<string>()
  for (const item of data.v_playlist) {
    const dirId = item.dirId ?? 0
    const dissId = item.tid ?? 0
    const key = dirId === 201 ? 'love' : 'playlist:' + (dissId || dirId)
    if ((!dissId && !dirId) || seen.has(key)) continue
    seen.add(key)
    const songs = await details(credential, dissId, dirId, dirId === 201 ? await encryptedUin(credential) : '')
    lists.push({
      key,
      name: dirId === 201 ? 'QQ 音乐 · 我喜欢' : 'QQ 音乐 · ' + (item.dirName ?? item.name ?? '歌单'),
      list: songs,
    })
  }
  // Some API versions omit "My Favorites" in v_playlist.
  if (!seen.has('love')) {
    const euin = await encryptedUin(credential)
    if (euin) {
      const songs = await details(credential, 0, 201, euin)
      lists.push({ key: 'love', name: 'QQ 音乐 · 我喜欢', list: songs })
    }
  }
  return lists
}
export const syncQQMusicAccount = async (credential: QQMusicCredential) => {
  const lists = await readQQMusicPlaylists(credential)
  return applyExternalMirrors('qqmusic:' + credential.musicId, lists)
}
