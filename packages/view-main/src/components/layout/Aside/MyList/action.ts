import { MEDIA_FILE_TYPES_LOCAL } from '@any-listen/common/constants'
import { updateUserList } from '@/modules/musicLibrary/store/listRemoteActions'

import { showSimpleConfirmModal } from '@/components/apis/dialog'
import { showNotify } from '@/components/apis/notify'
import {
  addListMusics,
  getListMusics,
  removeUserList as removeUserListRemote,
  setFetchingListStatus,
  syncUserList as syncUserListRemote,
  updateListMusicsPosition,
} from '@/modules/musicLibrary/store/actions'
import { settingState } from '@/modules/setting/store/state'
import { i18n } from '@/plugins/i18n'
import { showOpenDialog } from '@/shared/ipc/app'
import { addFolderMusics } from '@/shared/ipc/list'
import { createLocalMusicInfos } from '@/shared/ipc/music'

const handleAddMusics = async (listId: string, filePaths: string[], index = -1) => {
  // console.log(index + 1, index + 101)
  const paths = filePaths.slice(index + 1, index + 101)
  // TODO optimize: createLocalMusicInfos delay parseing music info, just get basic info first, then parse detail info when needed
  const musicInfos = await createLocalMusicInfos(paths)
  let failedCount = paths.length - musicInfos.length
  if (musicInfos.length) await addListMusics(listId, musicInfos)
  index += 100
  if (filePaths.length - 1 > index) {
    failedCount += await handleAddMusics(listId, filePaths, index)
  }
  return failedCount
}
const updateMusicPosition = async (listId: string, ids: string[]) => {
  const musicInfos = await getListMusics(listId, true)
  const musicIds = new Set(musicInfos.map((m) => m.id))
  ids = ids.filter((id) => musicIds.has(id))
  await updateListMusicsPosition({
    ids,
    listId,
    position: settingState.setting['list.addMusicLocationType'] === 'top' ? 0 : musicInfos.length - 1,
  })
}

export const importLocalFile = async (listInfo: AnyListen.List.MyListInfo) => {
  const { canceled, filePaths } = await showOpenDialog({
    title: i18n.t('user_list__select_local_file'),
    properties: ['openFile', 'multiSelections'],
    filters: [
      // https://support.google.com/chromebook/answer/183093
      // 3gp, .avi, .mov, .m4v, .m4a, .mp3, .mkv, .ogm, .ogg, .oga, .webm, .wav
      { name: 'Media File', extensions: [...MEDIA_FILE_TYPES_LOCAL] },
    ],
  })
  if (canceled || !filePaths.length) return
  console.log(filePaths)
  setFetchingListStatus(listInfo.id, true)
  const failedCount = await handleAddMusics(listInfo.id, filePaths)
  await updateMusicPosition(listInfo.id, filePaths)
  setFetchingListStatus(listInfo.id, false)
  const all = filePaths.length
  let message =
    failedCount == 0
      ? i18n.t('user_list__add_local_file_successfull', { num: all })
      : failedCount == all
        ? i18n.t('user_list__add_local_file_failed', { num: all })
        : i18n.t('user_list__add_local_file_success_part', { all, count: failedCount })
  showNotify(message)
}
export const importLocalFileFolder = async (listInfo: AnyListen.List.MyListInfo) => {
  const { canceled, filePaths } = await showOpenDialog({
    title: i18n.t('user_list__select_local_file_folder'),
    properties: ['openDirectory'],
    filters: [
      // https://support.google.com/chromebook/answer/183093
      // 3gp, .avi, .mov, .m4v, .m4a, .mp3, .mkv, .ogm, .ogg, .oga, .webm, .wav
      { name: 'Media File', extensions: [...MEDIA_FILE_TYPES_LOCAL] },
    ],
  })
  if (canceled || !filePaths.length) return
  setFetchingListStatus(listInfo.id, true)
  const taskId = await addFolderMusics(listInfo.id, filePaths, (message) => {
    switch (message) {
      case null:
        showNotify(i18n.t('user_list__add_local_file_folder_cancelled'))
        break
      case undefined:
        showNotify(i18n.t('user_list__add_local_file_folder_end'))
        break
      default:
        break
    }
    setFetchingListStatus(listInfo.id, false)
  })
  // setTimeout(() => {
  //   void cancelAddFolderMusics(taskId)
  // }, 1000)
  console.log(taskId)
}

export const syncUserList = async (listInfo: AnyListen.List.MyListInfo) => {
  setFetchingListStatus(listInfo.id, true)
  await syncUserListRemote(listInfo.id)
    .catch((e: Error) => {
      showNotify(i18n.t('user_list__sync_failed', { name: listInfo.name, err: e.message }))
      throw e
    })
    .finally(() => {
      setFetchingListStatus(listInfo.id, false)
    })
  showNotify(i18n.t('user_list__sync_successful', { name: listInfo.name }))
}

type DecoratedList = AnyListen.List.GeneralListInfo & {
  meta: AnyListen.List.UserListInfoByGeneralMeta & {
    externalMirror?: string
    archived?: boolean
    externalMirrorHidden?: boolean
  }
}
const isGeneral = (item: AnyListen.List.MyListInfo): item is AnyListen.List.GeneralListInfo => item.type === 'general'
const marked = (item: AnyListen.List.GeneralListInfo) => item as DecoratedList

/** Archive is a local, reversible view state; it does not delete platform data. */
export const archiveUserLists = async (items: AnyListen.List.MyListInfo[], archived: boolean) => {
  const eligible = items.filter(isGeneral)
  if (!eligible.length) return
  await updateUserList({
    lists: eligible.map(item => ({
      ...item,
      meta: { ...item.meta, archived, externalMirrorHidden: archived ? false : marked(item).meta.externalMirrorHidden },
    })),
  })
}

/** Restore hidden account mirrors explicitly; provider refresh never un-hides them. */
export const restoreHiddenMirrors = async (items: AnyListen.List.MyListInfo[]) => {
  const eligible = items.filter((item): item is AnyListen.List.GeneralListInfo =>
    isGeneral(item) && Boolean(marked(item).meta.externalMirrorHidden))
  if (!eligible.length) return
  await updateUserList({
    lists: eligible.map(item => ({
      ...item, meta: { ...item.meta, archived: false, externalMirrorHidden: false },
    })),
  })
}

/**
 * No extra danger-confirmation popup, as requested for ordinary user lists.
 * Cloud account mirrors are only hidden; LX-N writes happen ONLY after the
 * user explicitly enables the LX-N writable setting.
 * Local-file and remote-file list types remain excluded from this operation.
 */
export const removeUserLists = async (items: AnyListen.List.MyListInfo[]) => {
  const eligible = items.filter(isGeneral)
  const hide: DecoratedList[] = []
  const remove: string[] = []
  for (const info of eligible) {
    const item = marked(info)
    const marker = item.meta.externalMirror ?? ''
    const isAccountMirror = /^(netease|qqmusic|kugou):/.test(marker)
    const isLXMirror = marker.startsWith('lx-webdav:')
    const isLXSystem = isLXMirror && /:(default|love)$/.test(marker)
    if (isAccountMirror || (isLXMirror && (!settingState.setting['sync.lxWebdav.writeEnable'] || isLXSystem))) {
      hide.push(item)
    } else {
      remove.push(item.id)
    }
  }
  try {
    if (hide.length) {
      await updateUserList({
        lists: hide.map(item => ({
          ...item,
          meta: { ...item.meta, archived: false, externalMirrorHidden: true },
        })),
      })
    }
    if (remove.length) await removeUserListRemote(remove)
  } catch (err) {
    showNotify('批量移除歌单失败：' + (err as Error).message)
    throw err
  }
}
export const removeUserList = async (listInfo: AnyListen.List.MyListInfo) => {
  if (listInfo.type === 'general') return removeUserLists([listInfo])
  // A local/remote FILE list may physically delete music files. Keep the
  // upstream file-safety prompt for those types, separate from playlist deletion.
  const confirm = await showSimpleConfirmModal(i18n.t('lists.remove_tip', { name: listInfo.name }), {
    cancelBtn: i18n.t('cancel_button_text_2'),
    confirmBtn: i18n.t('confirm_button_text_2'),
  })
  if (!confirm) return
  await removeUserListRemote([listInfo.id]).catch((e: Error) => {
    showNotify(i18n.t('user_list__remove_failed', { name: listInfo.name, err: e.message }))
  })
}

export { updateUserListPosition } from '@/modules/musicLibrary/store/actions'
