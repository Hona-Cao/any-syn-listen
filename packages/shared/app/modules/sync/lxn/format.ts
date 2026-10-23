/**
 * LX-N v2 WebDAV playlists.json compatibility helpers.
 * Do not drop unknown LX fields: the Android client can require source-specific
 * metadata which Any Listen itself does not understand.
 */
import { createHash } from 'node:crypto'

export interface LXSong {
  id: string
  name: string
  singer?: string
  source: string
  interval?: string | null
  meta: Record<string, any>
  [key: string]: any
}

export interface LXUserList {
  id: string
  name: string
  source?: string
  sourceListId?: string
  locationUpdateTime?: number | null
  list: LXSong[]
  [key: string]: any
}

export interface LXFile {
  version?: string
  lastModified: number
  data: {
    defaultList: LXSong[]
    loveList: LXSong[]
    tempList: LXSong[]
    userList: LXUserList[]
    [key: string]: any
  }
  playHistory?: unknown[]
  downloadTasks?: unknown[]
  [key: string]: any
}

export interface RemoteList {
  key: string
  name: string
  songs: LXSong[]
}

export interface ManagedList {
  key: string
  name: string
  id: string
  songs: AnyListen.Music.MusicInfo[]
  info: AnyListen.List.UserListInfo
  newlyLinked: boolean
}

const PREFIX = 'LX-N · '
export const LX_N_PREFIX = PREFIX

export const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

const isRecord = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

const validateSongs = (value: unknown, location: string): asserts value is LXSong[] => {
  if (!Array.isArray(value)) throw new Error(location + ' is not an array')
  const ids = new Set<string>()
  for (const song of value) {
    if (!isRecord(song) || typeof song.id !== 'string' || !song.id ||
      typeof song.name !== 'string' || typeof song.source !== 'string' ||
      !isRecord(song.meta)) {
      throw new Error(location + ': unsupported or incomplete LX music item')
    }
    if (ids.has(song.source + ':' + song.id)) throw new Error(location + ': duplicated song identity')
    ids.add(song.source + ':' + song.id)
  }
}

export const parseLXFile = (raw: string): LXFile => {
  const file: unknown = JSON.parse(raw)
  if (!isRecord(file) || !isRecord(file.data) || !Number.isSafeInteger(file.lastModified) ||
    (file.version != null && file.version !== '2')) {
    throw new Error('Expected LX-N playlists.json v2 with lastModified')
  }
  validateSongs(file.data.defaultList, 'defaultList')
  validateSongs(file.data.loveList, 'loveList')
  validateSongs(file.data.tempList, 'tempList')
  if (!Array.isArray(file.data.userList)) throw new Error('userList is not an array')
  const userIds = new Set<string>()
  for (const list of file.data.userList) {
    if (!isRecord(list) || typeof list.id !== 'string' || !list.id || typeof list.name !== 'string') {
      throw new Error('Invalid LX-N user playlist')
    }
    if (userIds.has(list.id)) throw new Error('Duplicate LX-N user playlist id')
    userIds.add(list.id)
    validateSongs(list.list, 'userList/' + list.id)
  }
  return file as unknown as LXFile
}

export const remoteLists = (file: LXFile): RemoteList[] => [
  { key: 'default', name: '试听列表', songs: file.data.defaultList },
  { key: 'love', name: '我的收藏', songs: file.data.loveList },
  ...file.data.userList.map((list) => ({ key: 'user:' + list.id, name: list.name, songs: list.list })),
]

export const remoteHash = (file: LXFile): string => sha256(JSON.stringify({
  defaultList: file.data.defaultList,
  loveList: file.data.loveList,
  userList: file.data.userList,
}))

export const mirrorId = (key: string): string => 'lxn_' + sha256('lxn:' + key).slice(0, 24)

const qualityMap = (raw: Record<string, any> | undefined) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).map(([q, val]) => {
    const value = val && typeof val === 'object' ? val : {}
    return [q, { ...value, sizeStr: value.size ?? null }]
  }))
}

export const lxToAnySong = (lx: LXSong): AnyListen.Music.MusicInfo => {
  const { qualitys: _qualitys, _qualitys: originalQualitys, ...meta } = lx.meta
  const local = lx.source === 'local'
  const normalizedId = lx.source === 'kg' && !lx.id.startsWith('kg_') ? 'kg_' + lx.id : lx.id
  const common = {
    id: normalizedId,
    name: lx.name,
    singer: lx.singer ?? '',
    interval: lx.interval ?? null,
  }
  if (local) {
    return {
      ...common,
      isLocal: true,
      meta: {
        albumName: String(meta.albumName || ''),
        musicId: String(meta.songId ?? lx.id),
        createTime: 0,
        updateTime: 0,
        posTime: 0,
        picUrl: meta.picUrl ?? null,
        filePath: String(meta.filePath || ''),
        ext: String(meta.ext || ''),
        bitrateLabel: null,
        sizeStr: '',
        deviceId: 'lxn-mobile',
        lxnOriginalId: lx.id,
        lxnOriginalSource: lx.source,
      },
    } as AnyListen.Music.MusicInfo
  }
  return {
    ...common,
    isLocal: false,
    meta: {
      ...meta,
      source: lx.source,
      musicId: String(meta.songId ?? meta.id ?? lx.id),
      qualitys: qualityMap(originalQualitys),
      albumName: String(meta.albumName || ''),
      createTime: 0,
      updateTime: 0,
      posTime: 0,
      lxnOriginalId: lx.id,
      lxnOriginalSource: lx.source,
    },
  } as AnyListen.Music.MusicInfo
}

export const originalIdentity = (song: AnyListen.Music.MusicInfo): string => {
  const meta = song.meta as Record<string, any>
  const source = String(meta.lxnOriginalSource || meta.source || (song.isLocal ? 'local' : ''))
  const id = String(meta.lxnOriginalId || (source === 'kg' && song.id.startsWith('kg_') ? song.id.slice(3) : song.id))
  return source + ':' + id
}

export const lxSongIdentity = (song: LXSong): string => song.source + ':' + song.id

export const lxLookup = (file: LXFile): Map<string, LXSong> => {
  const map = new Map<string, LXSong>()
  for (const list of remoteLists(file)) {
    for (const song of list.songs) map.set(lxSongIdentity(song), song)
  }
  for (const song of file.data.tempList) map.set(lxSongIdentity(song), song)
  return map
}

/** Preserve a matching original LX entry, only reflecting visible edits. */
export const anyToLxSong = (song: AnyListen.Music.MusicInfo, lookup: Map<string, LXSong>): LXSong => {
  const existing = lookup.get(originalIdentity(song))
  if (existing) {
    return { ...existing, name: song.name, singer: song.singer, interval: song.interval }
  }
  if (song.isLocal) throw new Error('Cannot write a newly added desktop local-file track to LX-N')
  const meta = song.meta as Record<string, any>
  const source = meta.source
  if (!['kw', 'wy', 'kg', 'tx', 'mg', 'git'].includes(source)) {
    throw new Error('Unsupported LX-N music source: ' + String(source || 'unknown'))
  }
  const songId = String(meta.musicId || meta.songId || song.id)
  const rawId = source === 'kg' && song.id.startsWith('kg_') ? song.id.slice(3) : song.id
  const qualitys = (meta.qualitys || {}) as Record<string, { sizeStr?: string | null }>
  const _qualitys = Object.fromEntries(Object.entries(qualitys).map(([q, v]) => [q, { size: v?.sizeStr || null }]))
  const qualityList = Object.entries(_qualitys).map(([type, value]) => ({ type, ...value }))
  const { lxnOriginalId: _, lxnOriginalSource: _source, source: _metaSource, musicId: _musicId, ...safeMeta } = meta
  return {
    id: rawId,
    name: song.name,
    singer: song.singer,
    source,
    interval: song.interval,
    meta: {
      ...safeMeta,
      songId,
      albumName: String(meta.albumName || ''),
      qualitys: qualityList,
      _qualitys,
    },
  }
}

export const getManagedKey = (list: AnyListen.List.UserListInfo): string | null => {
  if (list.type !== 'general') return null
  const ext = list.meta as Record<string, any>
  if (ext.lxnKey && typeof ext.lxnKey === 'string') return ext.lxnKey
  // Opt-in to creating a new LX-N user playlist by naming it "LX-N · ...".
  if (list.name.startsWith(PREFIX)) return 'user:al_' + list.id
  return null
}

export const remoteName = (name: string): string => name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name

export const localHash = (lists: ManagedList[]): string =>
  sha256(JSON.stringify(lists.map(({ key, name, songs }) => ({
    key,
    name: remoteName(name),
    songs: songs.map((s) => ({
      id: s.id,
      name: s.name,
      singer: s.singer,
      interval: s.interval,
      source: originalIdentity(s),
    })),
  }))))

export const managedListInfo = (key: string, name: string, id?: string): AnyListen.List.UserListInfo => ({
  id: id ?? mirrorId(key),
  parentId: null,
  type: 'general',
  name: PREFIX + name,
  meta: {
    pic: '',
    desc: '',
    playCount: 0,
    createTime: Date.now(),
    updateTime: Date.now(),
    posTime: Date.now(),
    songCount: 0,
    lxnKey: key,
  },
}) as AnyListen.List.UserListInfo
