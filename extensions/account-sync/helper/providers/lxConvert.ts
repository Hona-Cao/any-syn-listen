interface MirrorPlaylist { key: string; name: string; list: any[] }

interface LXMusic {
  id?: string
  name?: string
  singer?: string
  interval?: string | null
  source?: string
  meta?: {
    id?: string | number
    songId?: string | number
    albumName?: string
    picUrl?: string
    _qualitys?: Record<string, { size?: string; [key: string]: unknown }>
    [key: string]: unknown
  }
}

const supportedSource = (source: string) => /^[a-z][a-z0-9_-]{0,30}$/i.test(source)
const qualityKeys = ['128k', '320k', 'flac', 'flac24bit', '192k', 'wav', 'dolby', 'master'] as const

export const convertLXMusic = (raw: LXMusic): AnyListen.Music.MusicInfoOnline | null => {
  if (!raw || !raw.id || !raw.name) return null
  // Android local file paths are not playable on desktop; never import these.
  if (raw.source === 'local') return null
  const source = raw.source || raw.id.split('_')[0]
  if (!supportedSource(source)) return null
  const meta = raw.meta ?? {}
  const originalId = String(meta.songId ?? meta.id ?? raw.id)
  const qualitys: AnyListen.Music.MusicQualityType = {}
  for (const [key, value] of Object.entries(meta._qualitys ?? {})) {
    const quality = key === 'flac32bit' ? 'flac24bit' : key
    if (!qualityKeys.some((k) => k === quality) || !value) continue
    qualitys[quality as AnyListen.Music.Quality] = {
      sizeStr: typeof value.size === 'string' ? value.size : null,
    }
  }
  const { _qualitys, ...otherMeta } = meta
  return {
    id: raw.id,
    name: raw.name,
    singer: raw.singer ?? '',
    interval: raw.interval ?? null,
    isLocal: false,
    meta: {
      ...otherMeta,
      source,
      musicId: originalId,
      albumName: meta.albumName ?? '',
      picUrl: meta.picUrl ?? '',
      qualitys,
      createTime: 0,
      updateTime: 0,
      posTime: 0,
    },
  }
}

const isObj = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const fromList = (list: unknown): AnyListen.Music.MusicInfoOnline[] => {
  if (!Array.isArray(list)) throw new Error('Invalid LX N playlist song array')
  return list.map((raw) => convertLXMusic(raw as LXMusic)).filter((m): m is AnyListen.Music.MusicInfoOnline => m != null)
}

/** The data layout is LX N Music v2 WebDAV playlists.json, NOT LX export .lxmc. */
export const parseLXWebDAVPlaylists = (content: string): MirrorPlaylist[] => {
  const file: unknown = JSON.parse(content)
  if (!isObj(file) || !isObj(file.data)) throw new Error('Invalid LX N WebDAV file')
  const data = file.data
  if (!Array.isArray(data.defaultList) || !Array.isArray(data.loveList) || !Array.isArray(data.userList)) {
    throw new Error('Unsupported LX N WebDAV playlists.json structure')
  }
  const lists: MirrorPlaylist[] = [
    { key: 'default', name: 'LX N · 试听列表', list: fromList(data.defaultList) },
    { key: 'love', name: 'LX N · 我的收藏', list: fromList(data.loveList) },
  ]
  const seen = new Set<string>()
  for (const raw of data.userList) {
    if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') continue
    if (seen.has(raw.id)) continue
    seen.add(raw.id)
    lists.push({
      key: 'user:' + raw.id,
      name: 'LX N · ' + raw.name,
      list: fromList(raw.list),
    })
  }
  return lists
}
