/**
 * A local-only marker ledger prevents native AnyListen WebDAV snapshots from
 * resurrecting externally deleted/hidden playlist mirrors in the sidebar.
 * This stores *identifiers only*, no song backups or account credentials.
 */
export const parseHiddenMirrorMarkers = (raw: string): Set<string> => {
  try {
    const values: unknown = JSON.parse(raw)
    return new Set(Array.isArray(values)
      ? values.filter((v): v is string =>
        typeof v === 'string' &&
        /^(?:netease|qqmusic|kugou|lx-webdav):/.test(v) && v.length <= 512)
      : [])
  } catch {
    return new Set()
  }
}

export const withHiddenMirrorMarkers = (raw: string, markers: readonly string[], hidden: boolean): string => {
  const current = parseHiddenMirrorMarkers(raw)
  for (const marker of markers) {
    if (!/^(?:netease|qqmusic|kugou|lx-webdav):/.test(marker) || marker.length > 512) continue
    if (hidden) current.add(marker)
    else current.delete(marker)
  }
  return JSON.stringify([...current])
}
