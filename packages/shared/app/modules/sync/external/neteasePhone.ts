import { getNeteaseAccountId, mergeSetCookies, requestNetease } from './neteaseSession'

const states = new Map<string, { sentAt: number; cookie: string }>()
const phoneOK = (phone: string) => {
  if (!/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确')
}
/** Trigger a single OTP request only after explicit user action. */
export const sendNeteasePhoneCode = async (phone: string): Promise<void> => {
  phoneOK(phone)
  const now = Date.now()
  const prev = states.get(phone)
  if (prev && now - prev.sentAt < 60_000) throw new Error('请稍后再获取验证码')
  const { setCookies } = await requestNetease('captcha/sent', prev?.cookie ?? '', {
    cellphone: phone, phone, ctcode: '86',
  })
  states.set(phone, {
    sentAt: now,
    cookie: mergeSetCookies(prev?.cookie ?? '', setCookies),
  })
}
/** The OTP never goes into settings, logs, WebDAV or playlist metadata. */
export const loginNeteaseWithPhoneCode = async (phone: string, code: string): Promise<string> => {
  phoneOK(phone)
  if (!/^\d{4,8}$/.test(code)) throw new Error('验证码格式不正确')
  const state = states.get(phone)
  if (!state || Date.now() - state.sentAt > 5 * 60_000) throw new Error('验证码已过期，请重新获取')
  const { setCookies } = await requestNetease('login/cellphone', state.cookie, {
    phone,
    captcha: code,
    countrycode: '86',
    rememberLogin: 'true',
  })
  const cookie = mergeSetCookies(state.cookie, setCookies)
  if (!/(?:^|;\s*)MUSIC_U=/.test(cookie)) {
    throw new Error('网易云未返回有效登录凭据')
  }
  await getNeteaseAccountId(cookie)
  states.delete(phone)
  return cookie
}
