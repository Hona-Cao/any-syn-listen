import { WebDAVClient } from '@any-listen/nodejs/webdav-client'

import { parseLXWebDAVPlaylists } from './lxConvert'
import { applyExternalMirrors } from './mirror'

export interface LXWebDAVOptions {
  url: string
  username: string
  password: string
  path: string
}

/**
 * Import the Android client's playlists.json as separate AnyListen user lists.
 * We never modify that file or the internal AnyListen WebDAV snapshots.
 */
export const syncLXWebDAV = async (options: LXWebDAVOptions) => {
  if (!options.url || !options.username) throw new Error('WebDAV server credentials are missing')
  const folder = '/' + (options.path || '/LX_Music/').replace(/^\/+|\/+$/g, '')
  const client = new WebDAVClient({
    baseUrl: options.url,
    username: options.username,
    password: options.password,
  })
  const raw = await client.get(folder + '/playlists.json')
  const playlists = parseLXWebDAVPlaylists(raw.toString())
  return applyExternalMirrors('lx-webdav:' + folder, playlists)
}
