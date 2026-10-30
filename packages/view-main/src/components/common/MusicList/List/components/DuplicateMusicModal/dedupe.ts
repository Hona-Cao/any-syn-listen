/**
 * Safe duplicate-cleanup planner. The discovery dialog intentionally groups by
 * normalized song title alone; destructive cleanup requires the SAME original
 * title, artist and duration so different covers/versions are not erased.
 */
export type DuplicateKeepRule = 'quality' | 'earliest' | 'latest'
export type AddPosition = 'top' | 'bottom'
export interface DuplicateCandidate {
  group: string
  index: number
  musicInfo: AnyListen.Music.MusicInfo
}
export interface DuplicateRemovalPlan {
  keepIds: string[]
  removeIds: string[]
  groupCount: number
  timeFallbackGroups: number
}

const ranks: Record<string, number> = {
  '128k': 1, '192k': 2, '320k': 3,
  wav: 4, flac: 5, sq: 5,
  flac24bit: 6, hr: 6, hi_res: 6,
  dolby: 7, atmos: 7, master: 8,
}

const normalize = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ')

export const getMusicQualityRank = (song: AnyListen.Music.MusicInfo): number => {
  const meta = song.meta
  let rank = 0
  if (!song.isLocal) {
    for (const [key, value] of Object.entries(song.meta.qualitys ?? {})) {
      if (value) rank = Math.max(rank, ranks[key.toLowerCase()] ?? 0)
    }
  }
  const ext = ('ext' in meta && typeof meta.ext === 'string' ? meta.ext : '').toLowerCase()
  const bitrate = ('bitrateLabel' in meta && typeof meta.bitrateLabel === 'string'
    ? meta.bitrateLabel : '').toLowerCase()
  if (bitrate.includes('24bit') || bitrate.includes('hi-res')) rank = Math.max(rank, ranks.flac24bit)
  for (const [name, value] of Object.entries(ranks)) {
    if (bitrate === name) rank = Math.max(rank, value)
  }
  if (ext === 'wav' || ext === 'flac') rank = Math.max(rank, ranks[ext] ?? 0)
  if (ext === 'mp3' && rank === 0) rank = ranks['128k']
  return rank
}

const getKnownTime = (item: DuplicateCandidate): number | null => {
  const time = item.musicInfo.meta.createTime
  return typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : null
}

const isPreferred = (a: DuplicateCandidate, b: DuplicateCandidate, rule: DuplicateKeepRule, side: AddPosition) => {
  if (rule === 'quality') {
    const diff = getMusicQualityRank(a.musicInfo) - getMusicQualityRank(b.musicInfo)
    if (diff) return diff > 0
  }
  const first = getKnownTime(a)
  const second = getKnownTime(b)
  const chronological = rule === 'latest' ? 'latest' : 'earliest'
  if (first != null && second != null && first !== second) {
    return chronological === 'earliest' ? first < second : first > second
  }
  // LX-N-imported songs have createTime=0. Without actual per-entry join
  // timestamps, use the displayed position as a documented approximation.
  const score = (side === 'top' ? -1 : 1) * (a.index - b.index)
  return chronological === 'earliest' ? score < 0 : score > 0
}

export const buildDuplicateRemovalPlan = (
  candidates: DuplicateCandidate[],
  rule: DuplicateKeepRule,
  insertionSide: AddPosition
): DuplicateRemovalPlan => {
  const groups = new Map<string, DuplicateCandidate[]>()
  for (const item of candidates) {
    const song = item.musicInfo
    const key = [item.group, normalize(song.name), normalize(song.singer), (song.interval ?? '').trim()].join('\u0000')
    const members = groups.get(key)
    if (members) members.push(item)
    else groups.set(key, [item])
  }
  const plan: DuplicateRemovalPlan = { keepIds: [], removeIds: [], groupCount: 0, timeFallbackGroups: 0 }
  for (const group of groups.values()) {
    if (group.length < 2 || new Set(group.map(item => item.musicInfo.id)).size !== group.length) continue
    let keep = group[0]
    for (const candidate of group.slice(1)) if (isPreferred(candidate, keep, rule, insertionSide)) keep = candidate
    plan.keepIds.push(keep.musicInfo.id)
    plan.removeIds.push(...group.filter(item => item !== keep).map(item => item.musicInfo.id))
    plan.groupCount++
    if (rule !== 'quality' && (group.some(item => getKnownTime(item) == null) ||
        new Set(group.map(item => getKnownTime(item))).size !== group.length)) {
      plan.timeFallbackGroups++
    }
  }
  return plan
}

export const duplicateListFingerprint = (list: AnyListen.Music.MusicInfo[]): string =>
  JSON.stringify(list.map(item => [
    item.id, item.name, item.singer, item.interval,
    item.meta.createTime, getMusicQualityRank(item),
  ]))
