import { showNotify } from '@/components/apis/notify'
import { submitPlatformPreference } from '@/shared/ipc/app'

export type SongPreferenceAction = 'like' | 'unlike' | 'dislike'

/**
 * Always called AFTER the local operation succeeds. A failed/unavailable
 * platform endpoint never undoes or misrepresents the local preference.
 */
export const reportSongPreference = async (
  song: AnyListen.Music.MusicInfo, action: SongPreferenceAction
): Promise<void> => {
  if (song.isLocal) {
    showNotify('偏好已保存在本地；本地文件没有云音乐平台反馈接口')
    return
  }
  const source = String(song.meta?.source ?? '')
  const id = String(song.meta?.musicId ?? '')
  const localAction = action === 'like' ? '喜欢已保存本地' : action === 'unlike'
    ? '已从本地喜欢中移除' : '不喜欢已保存在本地'
  try {
    const result = await submitPlatformPreference({ source, musicId: id, action })
    switch (result.status) {
      case 'sent':
        showNotify(localAction + '；' + result.platform + '已接收歌曲偏好反馈')
        return
      case 'login_required':
        showNotify(localAction + '；' + result.platform + '尚未授权，未同步平台')
        return
      case 'failed':
        showNotify(localAction + '；' + result.platform + '反馈提交失败，未声称同步成功')
        return
      case 'unsupported':
        showNotify(localAction + '；暂无经验证的' + result.platform + '反馈接口，仅本地生效')
        return
    }
  } catch {
    showNotify(localAction + '；平台反馈服务暂不可用，仅本地生效')
  }
}
