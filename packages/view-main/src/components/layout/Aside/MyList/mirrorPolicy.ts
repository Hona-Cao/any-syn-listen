/** Source-owned music-platform playlists are immutable in AnySynListen. */
export const isAccountMirrorMarker = (marker: string | null | undefined): boolean =>
  typeof marker === 'string' && /^(netease|qqmusic|kugou):/.test(marker)

export const canManagePlaylist = (marker: string | null | undefined): boolean =>
  !isAccountMirrorMarker(marker)

export const assertWritablePlaylists = (markers: readonly (string | null | undefined)[]): void => {
  if (markers.some(isAccountMirrorMarker)) {
    throw new Error('已选中网易云、QQ 或酷狗的只读歌单；请仅选择本地或 LX-N 歌单')
  }
}

/** Only LX-N user-created/saved daily lists (not source platform mirrors). */
export const isLXDailyArchiveMirror = (
  marker: string | null | undefined, name: string
): boolean => {
  if (!marker?.startsWith('lx-webdav:') || !marker.includes(':user:')) return false
  const stripped = name.replace(/^LX N · /, '')
  const mobile = /^(\d{1,2})_(\d{1,2})_daily$/i.exec(stripped)
  if (mobile) {
    const month = Number(mobile[1]), day = Number(mobile[2])
    if (month < 1 || month > 12) return false
    const date = new Date(Date.UTC(2000, month - 1, day))
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  }
  return /^每日推荐[\s_-]*[（(]?\d{4}[-/.]?\d{1,2}[-/.]?\d{1,2}[）)]?$/.test(stripped)
}
