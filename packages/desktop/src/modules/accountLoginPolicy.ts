/**
 * Dedicated Chromium partitions: never inspect the user's external Chrome profile.
 * Each login window can navigate ONLY to the owning provider and its known SSO hosts.
 */
export type MusicLoginProvider = 'netease' | 'qqmusic'
export const AUTH_PARTITIONS = {
  netease: 'persist:netease-auth',
  qqmusic: 'persist:qqmusic-auth',
} as const

const approvedHosts: Record<MusicLoginProvider, readonly string[]> = {
  netease: ['music.163.com', 'passport.163.com', 'reg.163.com', 'urs.163.com'],
  qqmusic: ['qq.com', 'weixin.qq.com'],
}

export const isTrustedLoginURL = (provider: MusicLoginProvider, url: string): boolean => {
  try {
    const dest = new URL(url)
    if (dest.protocol !== 'https:' || dest.username || dest.password || dest.port) return false
    return approvedHosts[provider].some((host) =>
      dest.hostname === host || (host === 'reg.163.com' && dest.hostname.endsWith('.reg.163.com')) ||
        ((host === 'qq.com' || host === 'weixin.qq.com') && dest.hostname.endsWith('.' + host))
    )
  } catch {
    return false
  }
}

export const musicCookieHeader = (cookies: ReadonlyArray<{ name: string; value: string }>): string =>
  cookies.filter(({ name, value }) =>
    /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && value.length > 0 && !/[\r\n;]/.test(value)
  ).map(({ name, value }) => name + '=' + value).join('; ')

export const neteaseHasAuthenticatedCookie = (cookie: string): boolean =>
  /(?:^|;\s*)MUSIC_U=[^;\s]+/.test(cookie)

export const isNeteaseAccountVerified = (response: unknown): response is { code: 200; account: { id: number } } => {
  if (!response || typeof response !== 'object') return false
  const body = response as { code?: unknown; account?: { id?: unknown } }
  return body.code === 200 && typeof body.account?.id === 'number' && Number.isSafeInteger(body.account.id) && body.account.id > 0
}

export const qqCredentialFromSession = (
  cookies: ReadonlyArray<{ domain?: string; name: string; value: string }>
): { musicId: string; musicKey: string } | null => {
  const matches = cookies.filter((cookie) =>
    cookie.domain === 'qq.com' || cookie.domain === '.qq.com' ||
    cookie.domain?.endsWith('.qq.com')
  )
  const values = new Map(matches.map(({ name, value }) => [name, value]))
  const musicKey = values.get('qqmusic_key') || values.get('qm_keyst') || ''
  const rawId = values.get('musicid') || values.get('qqmusic_uin') ||
    values.get('wxuin') || values.get('uin') || ''
  const musicId = rawId.replace(/^o/, '')
  return /^\d{4,20}$/.test(musicId) && musicKey.length > 0 && musicKey.length <= 2048
    ? { musicId, musicKey }
    : null
}
