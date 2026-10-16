/**
 * Platform playlist mirrors remain READ ONLY. An explicit user music-like
 * action is separate and may write to the source platform ONLY when a
 * verified authenticated API path exists.
 */
export type SongPreference = 'like' | 'unlike' | 'dislike'

export interface PreferenceInput {
  source: string
  musicId: string
  action: SongPreference
}
export type PreferencePlan =
  | { kind: 'netease-song-like'; musicId: string; liked: boolean; platform: '网易云' }
  | { kind: 'local-only'; platform: string; reason: 'unsupported-action' | 'unsupported-provider' | 'invalid-id' }

const label = (source: string): string =>
  source === 'wy' ? '网易云' : source === 'tx' ? 'QQ 音乐' : source === 'kg' ? '酷狗' : '未知来源'

export const planPlatformPreference = (input: PreferenceInput): PreferencePlan => {
  const platform = label(input.source)
  if (input.action === 'dislike') {
    return { kind: 'local-only', platform, reason: 'unsupported-action' }
  }
  // Do not confuse local song IDs with provider IDs or send a QQ song ID to
  // NetEase. Unknown provider APIs are not guessed.
  if (input.source !== 'wy') {
    return { kind: 'local-only', platform, reason: 'unsupported-provider' }
  }
  if (!/^\d{1,20}$/.test(input.musicId)) {
    return { kind: 'local-only', platform, reason: 'invalid-id' }
  }
  return {
    kind: 'netease-song-like',
    musicId: input.musicId,
    liked: input.action === 'like',
    platform: '网易云',
  }
}
