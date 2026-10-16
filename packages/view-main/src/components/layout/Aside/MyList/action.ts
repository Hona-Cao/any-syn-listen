import { MEDIA_FILE_TYPES_LOCAL } from '@any-listen/common/constants'
import { updateUserList, createUserList } from '@/modules/musicLibrary/store/listRemoteActions'
import { generateIdSimple } from '@/shared'
import { deleteLXPlaylistsNow } from '@/shared/ipc/sync'
import { withHiddenMirrorMarkers } from './mirrorVisibility'

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
import { updateSetting } from '@/modules/setting/store/action'
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

/**
 * Create a genuine writable LX-N user list, not a native AnyListen list.
 * Do not create a source mirror before the first remote-authoritative import.
 */
export const createLXUserList = async (): Promise<string> => {
  const config = settingState.setting
  if (!config['sync.lxWebdav.enable'] || !config['sync.lxWebdav.writeEnable'] ||
      !config['sync.lxWebdav.writeInitialized'] || !config['sync.lxWebdav.baseline']) {
    throw new Error('请先启用 LX-N 双向同步并完成首次 WebDAV 同步')
  }
  const id = generateIdSimple()
  const folder = '/' + (config['sync.lxWebdav.path'] || '/LX_Music/').replace(/^\/+|\/+$/g, '')
  const now = Date.now()
  const info: AnyListen.List.GeneralListInfo = {
    id,
    name: 'LX N · 新建歌单',
    type: 'general',
    parentId: null,
    meta: {
      externalMirror: 'lx-webdav:' + folder + ':user:' + id,
      createTime: now, updateTime: now, posTime: now,
      playCount: 0, songCount: 0, pic: '', desc: '',
    } as AnyListen.List.UserListInfoByGeneralMeta,
  }
  await createUserList({ position: -1, listInfos: [info] })
  return id
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

const rememberMirrorVisibility = async (
  items: AnyListen.List.MyListInfo[], hidden: boolean,
  key: 'sync.external.hiddenMirrors' | 'sync.external.deletedSourceMirrors' = 'sync.external.hiddenMirrors'
) => {
  const markers = items.filter(isGeneral).map(info => marked(info).meta.externalMirror).filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  )
  if (!markers.length) return
  const current = settingState.setting[key]
  const updated = withHiddenMirrorMarkers(current, markers, hidden)
  if (updated !== current) {
    if (key === 'sync.external.deletedSourceMirrors') {
      await updateSetting({ 'sync.external.deletedSourceMirrors': updated })
    } else {
      await updateSetting({ 'sync.external.hiddenMirrors': updated })
    }
  }
}

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
    isGeneral(item) && Boolean(marked(item).meta.externalMirror))
  if (!eligible.length) return
  await updateUserList({
    lists: eligible.map(item => ({
      ...item, meta: { ...item.meta, archived: false, externalMirrorHidden: false },
    })),
  })
  await rememberMirrorVisibility(eligible, false)
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
  const remoteLXUserIds: string[] = []
  const settings = settingState.setting
  const lxFolder = '/' + (settings['sync.lxWebdav.path'] || '/LX_Music/').replace(/^\/+|\/+$/g, '')
  const lxPrefix = 'lx-webdav:' + lxFolder + ':user:'
  const lxWritable = settings['sync.lxWebdav.enable'] &&
    settings['sync.lxWebdav.writeEnable'] &&
    settings['sync.lxWebdav.writeInitialized']
  for (const info of eligible) {
    const item = marked(info)
    const marker = item.meta.externalMirror ?? ''
    const isAccountMirror = /^(netease|qqmusic|kugou):/.test(marker)
    const isLXMirror = marker.startsWith('lx-webdav:')
    const lxSystem = isLXMirror && /:(default|love)$/.test(marker)
    if (isAccountMirror || (isLXMirror && (!lxWritable || lxSystem))) {
      // Account mirrors and read-only LX playlists are hidden permanently in
      // this desktop, never removed from their original provider.
      hide.push(item)
    } else if (isLXMirror) {
      if (!marker.startsWith(lxPrefix)) {
        throw new Error('该 LX-N 歌单不属于当前 WebDAV 来源，已拒绝删除')
      }
      const sourceId = marker.slice(lxPrefix.length)
      if (!sourceId || sourceId.includes(':')) throw new Error('LX-N 歌单来源标识无效')
      remoteLXUserIds.push(sourceId)
    } else {
      remove.push(item.id)
    }
  }
  try {
    // Do NOT optimistically delete LX user playlists in SQLite. The previous
    // implementation did so and periodic LX imports resurrected them while
    // WebDAV still held the originals. Commit the remote source first.
    if (remoteLXUserIds.length) {
      await deleteLXPlaylistsNow([...new Set(remoteLXUserIds)])
      await rememberMirrorVisibility(eligible.filter(item =>
        (marked(item).meta.externalMirror ?? '').startsWith(lxPrefix)
      ), true, 'sync.external.deletedSourceMirrors')
    }
    if (hide.length) {
      await rememberMirrorVisibility(hide, true)
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
