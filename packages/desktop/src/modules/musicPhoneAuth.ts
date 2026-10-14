import { runWebDAVSyncTask } from '@any-listen/app/modules/sync'
import { loginKugouWithPhoneCode, sendKugouPhoneCode } from '@any-listen/app/modules/sync/external/kugouMusic'
import { loginNeteaseWithPhoneCode, sendNeteasePhoneCode } from '@any-listen/app/modules/sync/external/neteasePhone'

import { updateSetting } from '@/app'

import { writeAccountSecret } from './accountVault'

type PhonePlatform = 'netease' | 'kugou'
export const requestMusicSMSCode = async (platform: PhonePlatform, phone: string): Promise<boolean> => {
  if (platform === 'netease') await sendNeteasePhoneCode(phone)
  else if (platform === 'kugou') await sendKugouPhoneCode(phone)
  else throw new Error('不支持的登录方式')
  return true
}
export const loginMusicWithSMSCode = async (platform: PhonePlatform, phone: string, code: string): Promise<boolean> => {
  if (platform === 'netease') {
    const cookie = await loginNeteaseWithPhoneCode(phone, code)
    await writeAccountSecret('netease', cookie)
    updateSetting({ 'sync.netease.cookie': '', 'sync.netease.enable': true })
  } else if (platform === 'kugou') {
    const credentials = await loginKugouWithPhoneCode(phone, code)
    await writeAccountSecret('kugou', JSON.stringify(credentials))
    updateSetting({ 'sync.kugou.enable': true })
  } else throw new Error('不支持的登录方式')
  runWebDAVSyncTask(true)
  return true
}
