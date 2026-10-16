/**
 * Pure LX-N Music WebDAV document handling. Always work from the full original
 * playlists.json: the AnyListen mirror deliberately cannot represent every
 * LX song field, so blindly serializing the mirror would destroy source data.
 */
export interface LXRawSong {
  id: string
  name: string
  singer?: string
  interval?: string | null
  source?: string
  meta?: Record<string, unknown>
  [key: string]: unknown
}
export interface LXRawUserList {
  id: string
  name: string
  list: LXRawSong[]
  [key: string]: unknown
}
export interface LXRawLibrary {
  defaultList: LXRawSong[]
  loveList: LXRawSong[]
  userList: LXRawUserList[]
  [key: string]: unknown
}
export interface LXRawDocument {
  version?: string
  lastModified?: number
  data: LXRawLibrary
  [key: string]: unknown
}
export interface LXLocalList {
  key: string
  name: string
  songs: Array<{ id: string; name: string; singer: string; interval: string | null; isLocal: boolean; meta: Record<string, unknown> }>
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const parseLXDocument = (content: string): LXRawDocument => {
  const parsed: unknown = JSON.parse(content)
  if (!object(parsed) || !object(parsed.data)) throw new Error('LX-N: invalid playlists.json document')
  const data = parsed.data
  if ('lastModified' in parsed &&
      (typeof parsed.lastModified !== 'number' || !Number.isSafeInteger(parsed.lastModified) || parsed.lastModified < 0)) {
    throw new Error('LX-N: invalid lastModified timestamp')
  }
  if (!Array.isArray(data.defaultList) || !Array.isArray(data.loveList) || !Array.isArray(data.userList)) {
    throw new Error('LX-N: missing complete playlist arrays')
  }
  const validateSongs = (list: unknown, label: string) => {
    if (!Array.isArray(list)) throw new Error('LX-N: invalid list ' + label)
    for (const song of list) {
      if (!object(song) || typeof song.id !== 'string' || typeof song.name !== 'string') {
        throw new Error('LX-N: invalid song in ' + label)
      }
    }
  }
  validateSongs(data.defaultList, 'default')
  validateSongs(data.loveList, 'love')
  const ids = new Set<string>()
  for (const item of data.userList) {
    if (!object(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || ids.has(item.id)) {
      throw new Error('LX-N: invalid or duplicated user playlist')
    }
    ids.add(item.id)
    validateSongs(item.list, item.id)
  }
  return parsed as unknown as LXRawDocument
}

const toRawSong = (song: LXLocalList['songs'][number]): LXRawSong => {
  if (song.isLocal || !song.id || !song.name || !/^[a-z][a-z0-9_-]{0,30}$/i.test(String(song.meta.source || song.id.split('_')[0]))) {
    throw new Error('LX-N: local or unsupported music cannot be written back')
  }
  // Do not leak AnyListen-only bookkeeping into the upstream song document.
  const { source, musicId, qualitys, createTime, updateTime, posTime, ...metadata } = song.meta
  return {
    id: song.id, name: song.name, singer: song.singer, interval: song.interval,
    source: String(source || song.id.split('_')[0]), meta: { ...metadata, id: musicId ?? song.id },
  }
}
const updateSongs = (original: LXRawSong[], changed: LXLocalList['songs']): LXRawSong[] => {
  const representable = (song: LXRawSong) =>
    Boolean(song.id && song.name && song.source !== 'local' &&
      /^[a-z][a-z0-9_-]{0,30}$/i.test(song.source || song.id.split('_')[0]))
  const visibleOriginal = original.filter(representable)
  const originalIds = visibleOriginal.map(song => song.id)
  const changedIds = changed.map(song => song.id)
  const sameOrder = JSON.stringify(originalIds) === JSON.stringify(changedIds)
  // Duplicate source IDs can be legitimate in Android lists, but the AnyListen
  // mirror deduplicates them. Never reinterpret a de-duplicated mirror as an
  // intended removal of duplicate entries.
  if (!sameOrder && new Set(originalIds).size !== originalIds.length) {
    throw new Error('LX-N: duplicate source song IDs make write-back ambiguous')
  }
  const patchSong = (originalSong: LXRawSong, song: LXLocalList['songs'][number]): LXRawSong => {
    // Keep the original LX metadata (including quality/source identifiers).
    // Changes to song display fields are allowed without losing metadata.
    if (originalSong.name === song.name &&
        (originalSong.singer ?? '') === song.singer &&
        (originalSong.interval ?? null) === song.interval) return originalSong
    return { ...originalSong, name: song.name, singer: song.singer, interval: song.interval }
  }
  if (sameOrder) {
    // Preserve Android-only local tracks in their original positions even
    // when the desktop mirror omits them. Unrelated playlist deletions should
    // still be able to sync without losing any unrepresentable songs.
    const byId = new Map(changed.map(song => [song.id, song]))
    return original.map(item => {
      const song = byId.get(item.id)
      return song && representable(item) ? patchSong(item, song) : item
    })
  }
  // A reordered/edited visible subset amidst opaque mobile-only songs can
  // be ambiguous; forbid such a write rather than silently dropping files.
  if (original.some(song => !representable(song))) {
    throw new Error('LX-N: list contains local/unsupported source songs; write-back refused')
  }
  const byId = new Map(original.map(song => [song.id, song]))
  const seen = new Set<string>()
  return changed.map(song => {
    if (seen.has(song.id)) throw new Error('LX-N: duplicate song IDs cannot be written back')
    seen.add(song.id)
    const item = byId.get(song.id)
    return item ? patchSong(item, song) : toRawSong(song)
  })
}

export const materializeLXDocument = (original: LXRawDocument, local: LXLocalList[], now: number): LXRawDocument => {
  const all = new Map<string, LXLocalList>()
  for (const entry of local) {
    if (all.has(entry.key)) throw new Error('LX-N: duplicate mirror ID')
    all.set(entry.key, entry)
  }
  if (!all.has('default') || !all.has('love')) {
    throw new Error('LX-N: cannot remove the source listening or favorites list')
  }
  const originalUsers = new Map(original.data.userList.map(item => ['user:' + item.id, item]))
  const users: LXRawUserList[] = []
  for (const mirror of local) {
    if (mirror.key === 'default' || mirror.key === 'love') continue
    if (!mirror.key.startsWith('user:') || mirror.key.slice(5).length === 0) {
      throw new Error('LX-N: invalid user playlist identity')
    }
    const source = originalUsers.get(mirror.key)
    // Only an intentionally marked LX mirror can reach this branch. New
    // user lists use the internal stable ID as their source identifier.
    const base: LXRawUserList = source ?? {
      id: mirror.key.slice(5), name: '', list: [],
    }
    users.push({
      ...base,
      name: mirror.name.startsWith('LX N · ') ? mirror.name.slice('LX N · '.length) : mirror.name,
      list: updateSongs(base.list, mirror.songs),
    })
  }
  return {
    ...original,
    lastModified: Math.max(now, (original.lastModified ?? 0) + 1),
    data: {
      ...original.data,
      defaultList: updateSongs(original.data.defaultList, all.get('default')!.songs),
      loveList: updateSongs(original.data.loveList, all.get('love')!.songs),
      userList: users,
    },
  }
}

export const signatureOfLXLocalLists = (local: LXLocalList[]): string =>
  JSON.stringify(local.map(item => [
    item.key, item.name, item.songs.map(song => [song.id, song.name, song.singer, song.interval]),
  ]))

/**
 * A first connection is always remote-authoritative, including if the user
 * has just enabled two-way mode. A persisted, same-source checkpoint is the
 * only proof that a later local difference is a new edit rather than an old
 * mirror left behind by a prior install.
 */
export const planLXDirection = (
  writeEnabled: boolean, baseline: string | undefined, sourcePrefix: string, currentHash: string
): 'import' | 'write' =>
  writeEnabled && baseline?.startsWith(sourcePrefix) && baseline !== sourcePrefix + currentHash
    ? 'write' : 'import'

/**
 * Permanently remove only explicitly selected LX-N USER playlists from a
 * validated WebDAV document. Neither the listening list nor favourites are
 * deletable. Preserve unrelated LX fields and never interpret read failures
 * as an empty remote library.
 */
export const removeLXUserListsFromDocument = (
  original: LXRawDocument, ids: readonly string[], now: number
): LXRawDocument => {
  const wanted = new Set(ids)
  if (!wanted.size || [...wanted].some(id => typeof id !== 'string' || !id.trim() || id.includes(':'))) {
    throw new Error('LX-N: invalid requested playlist deletions')
  }
  return {
    ...original,
    lastModified: Math.max(now, (original.lastModified ?? 0) + 1),
    data: {
      ...original.data,
      userList: original.data.userList.filter(item => !wanted.has(item.id)),
    },
  }
}

/**
 * A remote deletion must be committed and read back BEFORE any local mirror
 * reconciliation. This tiny IO boundary permits a real failure-path test
 * without accessing the user's WebDAV or music library.
 */
export const commitLXUserDeletion = async (
  sourceIds: readonly string[],
  readRemote: () => Promise<LXRawDocument>,
  writeRemote: (next: LXRawDocument) => Promise<void>,
  prepareLocalState?: (remote: LXRawDocument) => Promise<LXRawDocument>,
  now: () => number = Date.now
): Promise<LXRawDocument> => {
  if (!sourceIds.length || sourceIds.some(id => typeof id !== 'string' || !id.trim() || id.includes(':'))) {
    throw new Error('LX-N: invalid requested playlist deletions')
  }
  const raw = await readRemote()
  const wanted = new Set(sourceIds)
  if (!raw.data.userList.some(item => wanted.has(item.id))) {
    // Already deleted on the phone: do not replace newer unrelated content.
    return raw
  }
  const base = prepareLocalState ? await prepareLocalState(raw) : raw
  const next = removeLXUserListsFromDocument(base, sourceIds, now())
  await writeRemote(next)
  const readback = await readRemote()
  if (JSON.stringify(readback.data) !== JSON.stringify(next.data)) {
    throw new Error('LX-N: WebDAV delete verification failed')
  }
  return readback
}

/** Archiving only recognizes source-dated daily recommendation lists. */
export const datedLXRecommendations = (lists: Array<{ key: string; name: string }>): Set<string> => {
  const dates = lists.map(list => {
    const m = /^LX N · 每日推荐[\s_-]*[（(]?(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})[）)]?$/.exec(list.name)
    if (!m) return null
    const year = +m[1], month = +m[2], day = +m[3]
    const date = Date.UTC(year, month - 1, day)
    if (new Date(date).getUTCFullYear() !== year || new Date(date).getUTCMonth() !== month - 1 ||
      new Date(date).getUTCDate() !== day) return null
    return { key: list.key, date }
  }).filter((item): item is { key: string; date: number } => item !== null)
  const newest = Math.max(0, ...dates.map(item => item.date))
  return new Set(dates.filter(item => item.date < newest).map(item => item.key))
}
