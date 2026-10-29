/** Pure rules shared by batch playlist actions and regression tests. */
export const isProtectedLXMirror = (list: AnyListen.List.MyListInfo): boolean => {
  const key = (list.meta as { lxnKey?: string }).lxnKey
  return key === 'default' || key === 'love'
}

export const canBatchEditList = (list: AnyListen.List.MyListInfo): boolean =>
  list.type === 'general' && !isProtectedLXMirror(list)

/**
 * The regular music-library backend identifies tracks by their id.
 * Match that behavior when merging playlists: preserve order, skip songs
 * already in the destination, and do not introduce duplicate ids.
 */
export const collectNewMusic = (
  existing: AnyListen.Music.MusicInfo[],
  incoming: AnyListen.Music.MusicInfo[]
): AnyListen.Music.MusicInfo[] => {
  const ids = new Set(existing.map(song => song.id))
  const result: AnyListen.Music.MusicInfo[] = []
  for (const song of incoming) {
    if (ids.has(song.id)) continue
    ids.add(song.id)
    result.push(song)
  }
  return result
}

/** Preserve source song order regardless of the user's "add songs to top" option. */
export const buildCopyChunks = <T>(
  items: T[],
  size: number,
  placement: 'top' | 'bottom'
): T[][] => {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Invalid chunk size')
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return placement === 'top' ? chunks.reverse() : chunks
}
