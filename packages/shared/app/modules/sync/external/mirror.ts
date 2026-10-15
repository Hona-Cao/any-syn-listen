import { generateId } from '@any-listen/common/utils'

import { sendMusicListAction } from '../../musicList'
import { workers } from '../../worker'

/** An external source is authoritative only for the playlists it originally created. */
export interface MirrorPlaylist {
  key: string
  name: string
  list: AnyListen.Music.MusicInfoOnline[]
  archived?: boolean
}
type MarkedMeta = AnyListen.List.UserListInfoByGeneralMeta & { externalMirror?: string; archived?: boolean; externalMirrorHidden?: boolean; autoArchivedLXDaily?: boolean }

const buildMeta = (marker: string, songCount: number, archived = false): MarkedMeta => ({
  archived,
  autoArchivedLXDaily: archived,
  externalMirror: marker,
  createTime: Date.now(),
  updateTime: Date.now(),
  posTime: 0,
  playCount: 0,
  songCount,
  pic: '',
  desc: '',
})

/**
 * Upsert owned, read-only mirrors without touching native favorites, arbitrary
 * user playlists or AnyListen's snapshot protocol. Missing source playlists
 * are intentionally NOT deleted (a transient API error must not erase data).
 */
export const applyExternalMirrors = async (namespace: string, playlists: MirrorPlaylist[], options: { pruneMissing?: boolean } = {}) => {
  if (!namespace || !playlists.length) return 0
  const userLists = (await workers.dbService.getAllUserLists()).userList
  const owned = new Map<string, AnyListen.List.GeneralListInfo>()
  for (const item of userLists) {
    if (item.type !== 'general') continue
    const marker = (item.meta as MarkedMeta).externalMirror
    if (marker?.startsWith(namespace + ':')) owned.set(marker, item)
  }
  const seen = new Set<string>()
  let changed = 0
  for (const playlist of playlists) {
    const marker = namespace + ':' + playlist.key
    if (seen.has(marker)) continue
    seen.add(marker)
    const songs: AnyListen.Music.MusicInfoOnline[] = []
    const songIds = new Set<string>()
    for (const song of playlist.list) {
      if (!song.id || songIds.has(song.id)) continue
      songIds.add(song.id)
      songs.push(song)
    }
    // The same list can be read again without generating extra DB writes.
    const name = playlist.name.slice(0, 100)
    let current = owned.get(marker)
    if (!current) {
      current = {
        id: generateId(),
        name,
        type: 'general',
        parentId: null,
        meta: buildMeta(marker, songs.length, playlist.archived),
      }
      await sendMusicListAction({
        action: 'list_create',
        data: { position: -1, listInfos: [current] },
      })
      changed++
    } else if (current.name !== name || (playlist.archived && !((current.meta as MarkedMeta).autoArchivedLXDaily))) {
      const meta = current.meta as MarkedMeta
      const updated: AnyListen.List.GeneralListInfo = {
        ...current, name,
        meta: {
          ...meta,
          // Importing an old dated recommendation archives it once, without
          // re-archiving a list the user later deliberately restored.
          archived: playlist.archived && !meta.autoArchivedLXDaily ? true : meta.archived,
          autoArchivedLXDaily: meta.autoArchivedLXDaily || Boolean(playlist.archived),
          updateTime: Date.now(),
        } as MarkedMeta,
      }
      current = updated
      await sendMusicListAction({
        action: 'list_update',
        data: { lists: [updated] },
      })
      changed++
    }
    if (!current) throw new Error('External mirror could not be created')
    const old = await workers.dbService.getListMusics(current.id)
    // Check more than the ids: user edits to mirrored metadata are restored.
    const signature = (list: AnyListen.Music.MusicInfo[]) =>
      JSON.stringify(list.map((s) => [s.id, s.name, s.singer, s.interval, s.meta.musicId, s.meta.albumName, 'qualitys' in s.meta ? s.meta.qualitys : null, 'hash' in s.meta ? s.meta.hash : null]))
    if (signature(old) !== signature(songs)) {
      await sendMusicListAction({
        action: 'list_music_overwrite',
        data: { listId: current.id, musicInfos: songs },
      })
      changed++
    }
  }
  // Only an explicitly complete, validated LX-N snapshot may remove missing
  // mirrors. A partial third-party API response must never propagate deletions.
  if (options.pruneMissing) {
    const removed = [...owned].filter(([marker]) => !seen.has(marker)).map(([, item]) => item.id)
    if (removed.length) {
      await sendMusicListAction({ action: 'list_remove', data: removed })
      changed += removed.length
    }
  }
  return changed
}
