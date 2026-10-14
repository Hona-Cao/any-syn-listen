import { applyExternalMirrors, type MirrorPlaylist } from './mirror'
import { getNeteaseAccountId, requestNetease } from './neteaseSession'

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
export const syncNeteaseAccount = async (cookie: string) => {
  if (!/(?:^|;\s*)MUSIC_U=/.test(cookie)) throw new Error('NetEase MUSIC_U cookie required')
  const uid = await getNeteaseAccountId(cookie)
  const playlists: Array<{ id: number; name: string }> = []
  for (let offset = 0; offset < 5000; offset += 200) {
    const page = await post<{ code: number; playlist: Array<{ id: number; name: string }> }>(
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
