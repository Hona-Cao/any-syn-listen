<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { t } from '@/plugins/i18n'
  import Menu, { type MenuItem, type MenuList } from '@/components/base/Menu.svelte'
  import { LIST_IDS } from '@any-listen/common/constants'
  import { importLocalFile, importLocalFileFolder, removeUserList, syncUserList } from './action'
  import type { PlaylistBulkAction } from './selection'
  import { showListEditModal } from '@/components/apis/listEditModal'
  import { musicLibraryEvent } from '@/modules/musicLibrary/store/event'
  import { appState } from '@/modules/app/store/state'
  import { GENERAL_LIST_TYPES } from '@/shared/constants'

  let {
    onhide,
    onbatchaction,
  }: {
    onhide?: () => void
    onbatchaction?: (action: PlaylistBulkAction, lists: AnyListen.List.MyListInfo[]) => void
  } = $props()

  type MenuType =
    | 'create'
    | 'edit'
    | 'sort'
    | 'duplicate'
    | 'local_file'
    | 'local_file_folder'
    | 'update'
    | 'sourceDetail'
    | 'import'
    | 'export'
    | 'remove'
    | 'archive'
    | 'restore'
  let menuVisible = $state.raw(false)
  let menuLocation = $state.raw({ x: 0, y: 0 })
  let menus = $state.raw<MenuList<MenuType>>([])
  let info: AnyListen.List.MyListInfo | null
  let contextSelection: AnyListen.List.MyListInfo[] = []
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  let fetchingListStatus = new Set<string>()

  const setMenu = () => {
    if (contextSelection.length > 1) {
      // Never expose single-playlist editing actions for a multi-selection:
      // rename/import/sync has no well-defined group semantics.
      const total = contextSelection.length
      const fetching = contextSelection.some((item) => fetchingListStatus.has(item.id))
      menus = [
        { action: 'archive', label: '归档所选 ' + total + ' 张歌单' },
        { action: 'restore', label: '恢复所选 ' + total + ' 张歌单' },
        null,
        { action: 'remove', disabled: fetching, label: '删除所选 ' + total + ' 张歌单' },
      ]
      return
    }
    if (!info) {
      menus = [{ action: 'create', label: $t('user_list_menu__create') }]
      return
    }
    let edit = false
    // let update = false
    let remove = false
    // let local_file = !listState.fetchingListStatus[listInfo.id]
    // let userList: AnyListen.List.UserListInfo
    switch (info.id) {
      case LIST_IDS.DEFAULT:
      case LIST_IDS.LOVE:
        break
      default:
        // userList = info as AnyListen.List.UserListInfo
        edit = true
        remove = true
        break
    }

    const fetching = fetchingListStatus.has(info.id)
    const disabledUpdate = fetching || (info.type == 'local' && info.meta.deviceId != appState.machineId)
    const isGeneral = GENERAL_LIST_TYPES.includes(info.type)
    const isUserGeneral = info.type === 'general'
    const meta = info.meta as { archived?: boolean; externalMirrorHidden?: boolean }
    const hidden = Boolean(meta.archived || meta.externalMirrorHidden)

    menus = (
      [
        !isGeneral && { action: 'update', disabled: disabledUpdate, label: $t('user_list_menu__sync') },
        { action: 'create', label: $t('user_list_menu__create') },
        { action: 'edit', disabled: !edit, label: $t('user_list_menu__edit') },
        isGeneral && { action: 'local_file', disabled: fetching, label: $t('user_list_menu__select_local_file') },
        isGeneral && { action: 'local_file_folder', disabled: fetching, label: $t('user_list_menu__select_local_file_folder') },
        // null,
        // { action: 'sort', label: $t('user_list_menu__sort_list') },
        // { action: 'duplicate', label: $t('user_list_menu__duplicate') },
        // { action: 'sourceDetail', label: $t('user_list_menu__source_detail') },
        // { action: 'import', label: $t('user_list_menu__import') },
        // { action: 'export', label: $t('user_list_menu__export') },
        isUserGeneral && { action: 'archive', disabled: hidden, label: '归档歌单' },
        isUserGeneral && { action: 'restore', disabled: !hidden, label: '恢复歌单' },
        null,
        { action: 'remove', disabled: !remove || fetching, label: $t('user_list_menu__remove') },
      ] satisfies Array<MenuList<MenuType>[number] | false>
    ).filter((m) => m !== false)
  }

  export const show = async (
    selectInfo: AnyListen.List.MyListInfo | null,
    position: { x: number; y: number },
    selected: AnyListen.List.MyListInfo[] = []
  ) => {
    info = selectInfo
    contextSelection = selected.filter((item) => item.type === 'general')
    menuLocation = position
    setMenu()
    await tick()
    menuVisible = true
  }

  const handleClick = (menu: MenuItem<MenuType>) => {
    if (contextSelection.length > 1) {
      if (menu.action === 'archive' || menu.action === 'restore' || menu.action === 'remove') {
        onbatchaction?.(menu.action, [...contextSelection])
      }
      menuVisible = false
      return
    }
    switch (menu.action) {
      case 'create':
        void showListEditModal(info?.id)
        break
      case 'edit':
        void showListEditModal(info!.id, true)
        break
      case 'local_file':
        void importLocalFile(info!)
        break
      case 'local_file_folder':
        void importLocalFileFolder(info!)
        break
      case 'update':
        void syncUserList(info!)
        break
      case 'archive':
      case 'restore':
        if (info?.type === 'general') onbatchaction?.(menu.action, [info])
        break
      case 'remove':
        if (info?.type === 'general') onbatchaction?.('remove', [info])
        else void removeUserList(info!)
        break

      default:
        break
    }
    menuVisible = false
  }

  onMount(() => {
    const unsub = musicLibraryEvent.on('fetchingListStatusUpdated', (_id, status) => {
      if (status) fetchingListStatus.add(_id)
      else fetchingListStatus.delete(_id)
      if (info?.id != _id) return
      setMenu()
    })

    return () => {
      unsub()
      fetchingListStatus.clear()
    }
  })
</script>

<Menu bind:visible={menuVisible} {menus} location={menuLocation} onclick={handleClick} {onhide} />
