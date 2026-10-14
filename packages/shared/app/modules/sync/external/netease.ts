import type { MirrorPlaylist } from './mirror'
// @ts-ignore Native Node.js type-strip tests need an explicit TS extension; Vite resolves it.
import { getNeteaseAccountId, requestNetease } from './neteaseSession.ts'

const post = async <T extends { code: number; message?: string }>(route: string, cookie: string, body: object): Promise<T> => {
  return (await requestNetease<T>(route, cookie, body)).body
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
export const readNeteaseAccountPlaylists = async (cookie: string): Promise<{ uid: number; lists: MirrorPlaylist[] }> => {
  if (!/(?:^|;\s*)MUSIC_U=/.test(cookie)) throw new Error('NetEase MUSIC_U cookie required')
  const uid = await getNeteaseAccountId(cookie)
  const playlists: Array<{ id: number; name: string; specialType?: number }> = []
  for (let offset = 0; offset < 5000; offset += 200) {
    const page = await post<{ code: number; playlist: Array<{ id: number; name: string; specialType?: number }> }>(
      'user/playlist', cookie, { uid, offset, limit: 200, total: true, includeVideo: true }
    )
    if (!Array.isArray(page.playlist)) throw new Error('NetEase returned invalid account playlists')
    playlists.push(...page.playlist)
    if (page.playlist.length < 200) break
  }
  const mirrors: MirrorPlaylist[] = []
  for (const item of playlists) {
    const detail = await post<{ code: number; playlist?: { trackIds?: Array<{ id: number }>; trackCount?: number } }>(
      'v3/playlist/detail', cookie, { id: item.id, n: 100000, s: 8 }
    )
    if (!Array.isArray(detail.playlist?.trackIds)) {
      throw new Error('NetEase playlist trackIds missing; refuse empty overwrite')
    }
    const ids = detail.playlist.trackIds.map((track) => track.id)
    if (detail.playlist.trackCount != null && ids.length < detail.playlist.trackCount) {
      throw new Error('NetEase playlist metadata incomplete; preserve existing mirror')
    }
    const songs: AnyListen.Music.MusicInfoOnline[] = []
    for (let i = 0; i < ids.length; i += 300) {
      const batch = ids.slice(i, i + 300)
      const data = await post<{ code: number; songs: Song[] }>(
        'v3/song/detail', cookie, { c: JSON.stringify(batch.map((id) => ({ id }))) }
      )
      if (!Array.isArray(data.songs) || data.songs.length < batch.length) {
        throw new Error('NetEase song details incomplete; preserve existing mirror')
      }
      const map = new Map(data.songs.map((s) => [s.id, s]))
      for (const id of batch) {
        const s = map.get(id)
        if (s) songs.push(convert(s))
      }
    }
    if (songs.length !== ids.length) throw new Error('NetEase song list contains missing tracks')
    const loved = item.specialType === 5 || /喜欢的音乐$/.test(item.name)
    mirrors.push({ key: 'playlist:' + item.id, name: loved ? '网易云·我喜欢' : '网易云·' + item.name, list: songs })
  }
  if (!mirrors.some((item) => item.name === '网易云·我喜欢')) {
    try {
      const liked = await post<{ code: number; ids?: number[] }>('song/like/get', cookie, { uid: String(uid) })
      if (Array.isArray(liked.ids)) {
        const tracks: AnyListen.Music.MusicInfoOnline[] = []
        for (let start = 0; start < liked.ids.length; start += 300) {
          const ids = liked.ids.slice(start, start + 300)
          const detail = await post<{ code: number; songs: Song[] }>(
            'v3/song/detail', cookie, { c: JSON.stringify(ids.map((id) => ({ id }))) }
          )
          if (!Array.isArray(detail.songs) || detail.songs.length < ids.length) throw new Error('Incomplete NetEase likes')
          const map = new Map(detail.songs.map((song) => [song.id, song]))
          for (const id of ids) {
            const found = map.get(id)
            if (!found) throw new Error('Missing NetEase liked track')
            tracks.push(convert(found))
          }
        }
        mirrors.push({ key: 'love', name: '网易云·我喜欢', list: tracks })
      }
    } catch {
      // A private likes endpoint must not prevent syncing daily songs or user playlists.
    }
  }
  const daily = await post<{ code: number; data?: { dailySongs?: Song[] } }>(
    'v3/discovery/recommend/songs', cookie, { offset: 0, total: true, limit: 30 }
  )
  if (daily.data?.dailySongs) {
    mirrors.push({ key: 'daily', name: '网易云·每日推荐', list: daily.data.dailySongs.map(convert) })
  }
  return { uid, lists: mirrors }
}
export const syncNeteaseAccount = async (cookie: string) => {
  const { uid, lists } = await readNeteaseAccountPlaylists(cookie)
  const { applyExternalMirrors } = await import('./mirror')
  return applyExternalMirrors('netease:' + uid, lists)
}
