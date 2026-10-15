import { createHash } from 'node:crypto'

import { WebDAVClient } from '@any-listen/nodejs/webdav-client'

import { workers } from '../../worker'
import { parseLXWebDAVPlaylists } from './lxConvert'
import { materializeLXDocument, parseLXDocument, planLXDirection, signatureOfLXLocalLists, type LXLocalList } from './lxLibrary'
import { applyExternalMirrors } from './mirror'

export interface LXWebDAVOptions {
  url: string
  username: string
  password: string
  path: string
  writeEnable?: boolean
  /** Desktop settings persist only the fingerprint, not a shadow song backup. */
  baseline?: string
  saveBaseline?: (baseline: string) => Promise<void> | void
}
type MarkedMeta = AnyListen.List.UserListInfoByGeneralMeta & { externalMirror?: string }

const collectLXLists = async (namespace: string): Promise<LXLocalList[]> => {
  const userLists = (await workers.dbService.getAllUserLists()).userList
  const results: LXLocalList[] = []
  for (const item of userLists) {
    if (item.type !== 'general') continue
    const marker = (item.meta as MarkedMeta).externalMirror
    if (!marker?.startsWith(namespace + ':')) continue
    const songs = await workers.dbService.getListMusics(item.id)
    results.push({
      key: marker.slice(namespace.length + 1),
      name: item.name,
      songs: songs.map(song => ({
        id: song.id, name: song.name, singer: song.singer, interval: song.interval,
        isLocal: song.isLocal, meta: song.meta as unknown as Record<string, unknown>,
      })),
    })
  }
  return results
}

/**
 * LX-N's playlists.json is separate from AnyListen's own WebDAV snapshots.
 * The FIRST writable sync always downloads the authoritative remote library.
 * Afterwards, a locally modified mirror is allowed to replace that complete
 * LX library; failures never masquerade as source deletions.
 */
export const syncLXWebDAV = async (options: LXWebDAVOptions) => {
  if (!options.url || !options.username) throw new Error('WebDAV server credentials are missing')
  const folder = '/' + (options.path || '/LX_Music/').replace(/^\/+|\/+$/g, '')
  const namespace = 'lx-webdav:' + folder
  const key = createHash('sha256').update(options.url.replace(/\/$/, '') + ':' + folder).digest('hex').slice(0, 24) + ':'
  const client = new WebDAVClient({
    baseUrl: options.url,
    username: options.username,
    password: options.password,
  })
  const filename = folder + '/playlists.json'
  const rawContent = (await client.get(filename)).toString()
  const original = parseLXDocument(rawContent)
  const remotePlaylists = parseLXWebDAVPlaylists(rawContent)
  const owned = await collectLXLists(namespace)
  const currentSignature = createHash('sha256').update(signatureOfLXLocalLists(owned)).digest('hex')
  const direction = planLXDirection(Boolean(options.writeEnable), options.baseline, key, currentSignature)
  if (direction === 'write') {
    const next = materializeLXDocument(original, owned, Date.now())
    const json = JSON.stringify(next)
    // This WebDAV client does not provide an atomic ETag conditional PUT; the
    // unmodified LX-N app can concurrently merge changes on its own.
    await client.putData(filename, json)
    const check = parseLXDocument((await client.get(filename)).toString())
    if (JSON.stringify(check.data) !== JSON.stringify(next.data)) {
      throw new Error('LX-N: WebDAV write verification failed; remote library differs')
    }
    const changed = await applyExternalMirrors(namespace, parseLXWebDAVPlaylists(JSON.stringify(check)), {
      pruneMissing: true,
    })
    const updated = await collectLXLists(namespace)
    await options.saveBaseline?.(key + createHash('sha256').update(signatureOfLXLocalLists(updated)).digest('hex'))
    return changed
  }

  // Even when read-only, a VALID complete source snapshot can delete old LX
  // mirrors; otherwise phone-deleted history would reappear forever.
  const changed = await applyExternalMirrors(namespace, remotePlaylists, { pruneMissing: true })
  const updated = await collectLXLists(namespace)
  await options.saveBaseline?.(key + createHash('sha256').update(signatureOfLXLocalLists(updated)).digest('hex'))
  return changed
}
