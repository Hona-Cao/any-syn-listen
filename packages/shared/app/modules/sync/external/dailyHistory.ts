import type { MirrorPlaylist } from './mirror'

/**
 * Account platforms own a single mutable "daily" playlist. Optional history
 * takes a frozen snapshot for each calendar date in the provider's timezone.
 * Never change the original provider's playlists or write back remotely.
 */
export const dailyHistoryKey = (now: Date): string => {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  // Consistent ISO spelling even where Intl emits localized separators.
  const m = /(\d{4})[/-](\d{2})[/-](\d{2})/.exec(date)
  if (!m) throw new Error('Unable to determine provider daily recommendation date')
  return m[1] + '-' + m[2] + '-' + m[3]
}
export const addOptionalDailyHistory = (
  lists: MirrorPlaylist[], enabled: boolean, date = new Date()
): MirrorPlaylist[] => {
  if (!enabled) return lists
  const daily = lists.find(item => item.key === 'daily')
  if (!daily || !daily.list.length) return lists
  const yyyyMMdd = dailyHistoryKey(date)
  return [...lists, {
    key: 'daily-history:' + yyyyMMdd,
    name: daily.name + ' ' + yyyyMMdd,
    list: [...daily.list],
    archived: true,
  }]
}
