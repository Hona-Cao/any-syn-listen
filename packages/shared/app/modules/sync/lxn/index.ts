/**
 * Independent LX-N WebDAV compatibility sync. No change to Any Listen's own
 * snapshot protocol. Explicit opt-in; first synchronization is download-only.
 * A pair of hashes is persisted to detect concurrent edits on both sides.
 */
import { workers } from '../../worker'
import { sendMusicListAction } from '../../musicList'
import { WebDAVClient, is404Error } from '@any-listen/nodejs/webdav-client'
import {
  type LXFile, type LXUserList, type ManagedList, getManagedKey,
  localHash, remoteLogicalHash, lxLookup, lxToAnySong, anyToLxSong, managedListInfo, mirrorId,
  parseLXFile, remoteHash, remoteLists, remoteName,
} from './format'

type Config = {
  url: string
  username: string
  password: string
  path: string
  baselineRemote: string
  baselineLocal: string
  writeEnabled: boolean
}
export type LXSyncResolution = 'remote' | 'local'
export interface LXSyncResult {
  action: 'downloaded' | 'uploaded' | 'unchanged'
  listCount: number
  remoteTimestamp: number
  baselineRemote: string
  baselineLocal: string
}
let syncing = false

const targetPath = (path: string) => {
  const normalized = '/' + (path || '/LX_Music/').split('/').filter(Boolean).join('/')
  return normalized + '/playlists.json'
}
const createClient = (config: Config) =>
  new WebDAVClient({ baseUrl: config.url, username: config.username, password: config.password })

const collectLocal = async () => {
  const info = await workers.dbService.getAllUserLists()
  const result: ManagedList[] = []
  for (const list of info.userList) {
    const key = getManagedKey(list)
    if (!key) continue
    const songs = await workers.dbService.getListMusics(list.id)
    result.push({
      key, name: list.name, id: list.id, songs, info: list,
      newlyLinked: !(list.meta as Record<string, unknown>).lxnKey,
    })
  }
  const keys = new Set<string>()
  for (const list of result) {
    if (keys.has(list.key)) throw new Error('Duplicate LX-N binding: ' + list.key)
    keys.add(list.key)
  }
  return result.sort((a, b) => a.key.localeCompare(b.key))
}
const readRemote = async (client: WebDAVClient, path: string): Promise<{ file: LXFile; raw: string }> => {
  let data: Buffer
  try {
    data = await client.get(path)
  } catch (err) {
    if (is404Error(err)) throw new Error('LX-N playlists.json not found. Sync a playlist from your phone first.')
    throw err
  }
  const raw = data.toString('utf8')
  return { file: parseLXFile(raw), raw }
}

const applyRemote = async (file: LXFile, local: ManagedList[]) => {
  const remote = remoteLists(file)
  const byKey = new Map(local.map((x) => [x.key, x]))
  const current = await workers.dbService.getAllUserLists()
  const existingIds = new Set(current.userList.map((x) => x.id))
  const expected = new Set(remote.map(x => x.key))

  // Remove only confirmed LX-N mirrors. Never delete non-LX user lists.
  const removable = local.filter(x => !expected.has(x.key) && !x.newlyLinked).map(x => x.id)
  if (removable.length) await sendMusicListAction({ action: 'list_remove', data: removable })

  for (const entry of remote) {
    const old = byKey.get(entry.key)
    const id = old?.id || mirrorId(entry.key)
    if (existingIds.has(id) && !old) {
      throw new Error('LX-N mirror id collision: ' + id)
    }
    const songs = entry.songs.map(lxToAnySong)
    const nextName = 'LX-N · ' + entry.name
    if (!old) {
      const info = managedListInfo(entry.key, entry.name, id)
      info.meta.songCount = songs.length
      await sendMusicListAction({ action: 'list_create', data: { position: -1, listInfos: [info] } })
    } else if (old.name !== nextName || old.newlyLinked) {
      const info = {
        ...old.info,
        name: nextName,
        meta: { ...old.info.meta, lxnKey: entry.key, songCount: songs.length, updateTime: Date.now() },
      } as AnyListen.List.MyListInfo
      await sendMusicListAction({ action: 'list_update', data: { lists: [info], sync: false } })
    }
    // Do not overwrite mirror music just because only device-specific metadata
    // or cached cover/quality fields changed elsewhere.
    const sameLogicalSongs = old && localHash([{ ...old, name: nextName }]) ===
      localHash([{ ...old, name: nextName, songs }])
    if (!sameLogicalSongs) {
      await sendMusicListAction({ action: 'list_music_overwrite', data: { listId: id, musicInfos: songs } })
    }
  }
}

const writeLocal = (remote: LXFile, local: ManagedList[]): LXFile => {
  const lookup = lxLookup(remote)
  const managed = new Map(local.map(l => [l.key, l]))
  const entries = new Map(remote.data.userList.map(item => ['user:' + item.id, item]))
  const toSongs = (list: ManagedList) => list.songs.map(song => anyToLxSong(song, lookup))

  const newUsers: LXUserList[] = []
  for (const original of remote.data.userList) {
    const match = managed.get('user:' + original.id)
    if (!match) continue // deletion of LX-N-managed list
    newUsers.push({
      ...original,
      name: remoteName(match.name),
      locationUpdateTime: Date.now(),
      list: toSongs(match),
    })
  }
  for (const list of local) {
    if (!list.key.startsWith('user:') || entries.has(list.key)) continue
    const id = list.key.slice('user:'.length)
    if (!id) throw new Error('Invalid new LX-N playlist id')
    newUsers.push({ id, name: remoteName(list.name), locationUpdateTime: Date.now(), list: toSongs(list) })
  }
  // Preserve any upstream extensions including downloadTasks, playHistory,
  // tempList, and unknown v2 fields.
  return {
    ...remote,
    version: '2',
    lastModified: Math.max(Date.now(), remote.lastModified + 1),
    data: {
      ...remote.data,
      defaultList: managed.has('default') ? toSongs(managed.get('default')!) : remote.data.defaultList,
      loveList: managed.has('love') ? toSongs(managed.get('love')!) : remote.data.loveList,
      userList: newUsers,
    },
  }
}

export const runLXSync = async (config: Config, resolution?: LXSyncResolution): Promise<LXSyncResult> => {
  if (syncing) throw new Error('LX-N sync already running')
  if (!config.url || !config.username) throw new Error('Configure the WebDAV URL and username first')
  syncing = true
  try {
    const client = createClient(config)
    const path = targetPath(config.path)
    const { file, raw: originalRemoteRaw } = await readRemote(client, path)
    const remoteVersion = remoteHash(file)
    const remoteContentVersion = remoteLogicalHash(file)
    const local = await collectLocal()
    const localVersion = localHash(local)
    const firstSync = !config.baselineRemote || !config.baselineLocal
    const remoteChanged = !firstSync && remoteVersion !== config.baselineRemote
    const localChanged = !firstSync && localVersion !== config.baselineLocal

    // Two computers may reach exactly the same playlist state through LX-N and
    // Any Listen's independent snapshot sync. Their saved base hashes can both
    // be outdated: content equality is stronger evidence than baseline equality.
    if (!firstSync && localVersion === remoteContentVersion) {
      return {
        action: 'unchanged',
        listCount: remoteLists(file).length,
        remoteTimestamp: file.lastModified,
        baselineRemote: remoteVersion,
        baselineLocal: localVersion,
      }
    }

    if (firstSync || resolution === 'remote' || (remoteChanged && !localChanged)) {
      // The user requested no persisted backups. Initial/cloud-first import
      // replaces only LX-N mirrors; it does not create extra files on disk.
      await applyRemote(file, local)
      const nextLocal = await collectLocal()
      return {
        action: 'downloaded',
        listCount: remoteLists(file).length,
        remoteTimestamp: file.lastModified,
        baselineRemote: remoteVersion,
        baselineLocal: localHash(nextLocal),
      }
    }
    if (remoteChanged && localChanged && !resolution) {
      throw new Error('LX-N sync conflict: both sides changed. No data overwritten. Choose which side to keep.')
    }
    if (localChanged || resolution === 'local') {
      if (!config.writeEnabled) {
        throw new Error('Local LX-N mirrors changed. Enable two-way writing to upload, or choose cloud-only recovery.')
      }
      if (!local.some(l => l.key === 'default') || !local.some(l => l.key === 'love')) {
        throw new Error('LX-N mandatory default/love mirrors are missing; refusing destructive upload.')
      }
      const updated = writeLocal(file, local)
      const content = JSON.stringify(updated)
      // Ordinary WebDAV has no guaranteed atomic compare-and-swap on every
      // provider. Still check the entire raw file immediately before PUT.
      const check = await readRemote(client, path)
      if (check.raw !== originalRemoteRaw) {
        throw new Error('LX-N remote file changed during upload; no overwrite attempted (including history/downloads).')
      }
      await client.putData(path, content)
      const verify = await readRemote(client, path)
      if (remoteHash(verify.file) !== remoteHash(updated)) {
        throw new Error('LX-N upload verification failed; the remote may have changed.')
      }
      for (const list of local.filter(x => x.newlyLinked)) {
        await sendMusicListAction({
          action: 'list_update',
          data: {
            lists: [{ ...list.info, meta: { ...list.info.meta, lxnKey: list.key } }],
            sync: false,
          },
        })
      }
      const next = await collectLocal()
      return {
        action: 'uploaded',
        listCount: remoteLists(updated).length,
        remoteTimestamp: updated.lastModified,
        baselineRemote: remoteHash(updated),
        baselineLocal: localHash(next),
      }
    }
    return {
      action: 'unchanged',
      listCount: remoteLists(file).length,
      remoteTimestamp: file.lastModified,
      baselineRemote: remoteVersion,
      baselineLocal: localVersion,
    }
  } finally {
    syncing = false
  }
}
