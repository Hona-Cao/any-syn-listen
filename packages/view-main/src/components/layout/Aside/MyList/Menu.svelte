<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { t } from '@/plugins/i18n'
  import Menu, { type MenuItem, type MenuList } from '@/components/base/Menu.svelte'
  import { LIST_IDS } from '@any-listen/common/constants'
  import { importLocalFile, importLocalFileFolder, removeUserList, syncUserList } from './action'
  import { showListEditModal } from '@/components/apis/listEditModal'
  import { showSimpleConfirmModal } from '@/components/apis/dialog'
  import { showNotify } from '@/components/apis/notify'
  import { musicLibraryEvent } from '@/modules/musicLibrary/store/event'
  import { appState } from '@/modules/app/store/state'
  import { settingState } from '@/modules/setting/store/state'
  import { GENERAL_LIST_TYPES } from '@/shared/constants'
  import { addListMusics, getListMusics, removeUserList as removeUserLists } from '@/modules/musicLibrary/store/actions'
  import { defaultLists, useUserList } from '@/modules/musicLibrary/reactive.svelte'
  import { canBatchEditList, collectNewMusic, buildCopyChunks } from './batchUtils'

  let {
    onhide,
    onstartbatch,
    onselectall,
    onexitbatch,
    onrenameselected,
    onbatchcomplete,
  }: {
    onhide?: () => void
    onstartbatch?: (id?: string) => void
    onselectall?: () => void
    onexitbatch?: () => void
    onrenameselected?: (ids: string[]) => void
    onbatchcomplete?: () => void
  } = $props()

  type MenuType =
    | 'create'
    | 'edit'
    | 'local_file'
    | 'local_file_folder'
    | 'update'
    | 'copy_list'
    | 'remove'
    | 'start_batch'
    | 'select_all'
    | 'batch_copy'
    | 'batch_rename'
    | 'batch_delete'
    | 'exit_batch'
    | 'back'
    | `target:${string}`

  let menuVisible = $state.raw(false)
  let menuLocation = $state.raw({ x: 0, y: 0 })
  let menus = $state.raw<MenuList<MenuType>>([])
  let info: AnyListen.List.MyListInfo | null = null
  let batchMode = false
  let selectedIds: string[] = []
  let menuView: 'main' | 'targets' = 'main'
  let fetchingListStatus = new Set<string>()

  const userLists = useUserList(null)
  const lists = $derived([...$defaultLists, ...userLists.val])
  const isSelectable = (list: AnyListen.List.MyListInfo) =>
    !(list.type === 'local' && list.meta.deviceId !== appState.machineId)

  const setMenu = () => {
    if (menuView === 'targets') {
      const targets = lists.filter((list) =>
        GENERAL_LIST_TYPES.includes(list.type) && !selectedIds.includes(list.id)
      )
      menus = [
        { action: 'back', label: '返回' },
        null,
        ...targets.map((list) => ({ action: `target:${list.id}` as const, label: list.name })),
      ]
      return
    }

    if (batchMode) {
      const selected = lists.filter((list) => selectedIds.includes(list.id))
      const editableSelected = selected.filter(canBatchEditList)
      const selectable = lists.filter(isSelectable)
      const allSelected = selectable.length > 0 && selectable.every((list) => selectedIds.includes(list.id))
      menus = [
        { action: 'select_all', label: allSelected ? '取消全选' : '全选' },
        null,
        { action: 'batch_copy', label: '导入到其他列表', disabled: !selectedIds.length },
        { action: 'batch_rename', label: '批量编辑名称', disabled: !editableSelected.length },
        { action: 'batch_delete', label: '批量删除', disabled: !editableSelected.length },
        null,
        { action: 'exit_batch', label: '退出批量选择' },
      ]
      return
    }

    if (!info) {
      menus = [
        { action: 'create', label: $t('user_list_menu__create') },
        { action: 'start_batch', label: '批量选择' },
      ]
      return
    }

    const isDefault = info.id === LIST_IDS.DEFAULT || info.id === LIST_IDS.LOVE
    const editable = !isDefault
    const fetching = fetchingListStatus.has(info.id)
    const disabledUpdate = fetching || (info.type === 'local' && info.meta.deviceId !== appState.machineId)
    const isGeneral = GENERAL_LIST_TYPES.includes(info.type)

    menus = (
      [
        !isGeneral && { action: 'update', disabled: disabledUpdate, label: $t('user_list_menu__sync') },
        { action: 'create', label: $t('user_list_menu__create') },
        { action: 'edit', disabled: !editable, label: $t('user_list_menu__edit') },
        isGeneral && { action: 'local_file', disabled: fetching, label: $t('user_list_menu__select_local_file') },
        isGeneral && { action: 'local_file_folder', disabled: fetching, label: $t('user_list_menu__select_local_file_folder') },
        {
          action: 'copy_list',
          label: '导入到其他列表',
          disabled: !isSelectable(info),
        },
        { action: 'start_batch', label: '批量选择', disabled: !isSelectable(info) },
        null,
        { action: 'remove', disabled: !editable || fetching, label: $t('user_list_menu__remove') },
      ] satisfies Array<MenuList<MenuType>[number] | false>
    ).filter((item) => item !== false)
  }

  export const show = async (
    selectInfo: AnyListen.List.MyListInfo | null,
    position: { x: number; y: number },
    isBatchMode = false,
    ids: string[] = []
  ) => {
    info = selectInfo
    menuLocation = position
    batchMode = isBatchMode
    selectedIds = [...ids]
    menuView = 'main'
    setMenu()
    await tick()
    menuVisible = true
  }

  const showTargets = async (ids: string[]) => {
    selectedIds = [...ids]
    menuView = 'targets'
    setMenu()
    menuVisible = false
    await tick()
    menuVisible = true
  }

  const copyToTarget = async (targetId: string) => {
    const target = lists.find((list) => list.id === targetId)
    const sources = selectedIds.filter((id) => id !== targetId && lists.some((list) => list.id === id && isSelectable(list)))
    if (!target || !sources.length) {
      showNotify('请选择目标列表')
      return
    }

    try {
      const incoming: AnyListen.Music.MusicInfo[] = []
      for (const sourceId of sources) incoming.push(...(await getListMusics(sourceId, true)))
      const existing = await getListMusics(targetId, true)
      const songs = collectNewMusic(existing, incoming)
      if (!songs.length) {
        showNotify('目标列表已包含这些歌曲')
        return
      }
      const chunks = buildCopyChunks(songs, 300, settingState.setting['list.addMusicLocationType'])
      for (const chunk of chunks) await addListMusics(targetId, chunk)
      showNotify(`已导入 ${songs.length} 首歌曲`)
      onbatchcomplete?.()
    } catch (error) {
      showNotify(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const deleteSelected = async () => {
    const selected = lists.filter((list) => selectedIds.includes(list.id))
    const deletable = selected.filter(canBatchEditList)
    if (!deletable.length) {
      showNotify('没有可删除的自建歌单')
      return
    }
    const confirmed = await showSimpleConfirmModal(`删除选中的 ${deletable.length} 个歌单？`)
    if (!confirmed) return
    try {
      await removeUserLists(deletable.map((list) => list.id))
      showNotify(`已删除 ${deletable.length} 个歌单`)
      onbatchcomplete?.()
    } catch (error) {
      showNotify(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleClick = async (item: MenuItem<MenuType>) => {
    if (item.action.startsWith('target:')) {
      menuVisible = false
      await copyToTarget(item.action.slice('target:'.length))
      return
    }

    switch (item.action) {
      case 'create':
        void showListEditModal(info?.id)
        break
      case 'edit':
        if (info) void showListEditModal(info.id, true)
        break
      case 'local_file':
        if (info) void importLocalFile(info)
        break
      case 'local_file_folder':
        if (info) void importLocalFileFolder(info)
        break
      case 'update':
        if (info) void syncUserList(info)
        break
      case 'copy_list':
        if (info) {
          await showTargets([info.id])
          return
        }
        break
      case 'start_batch':
        onstartbatch?.(info && isSelectable(info) ? info.id : undefined)
        break
      case 'select_all':
        onselectall?.()
        break
      case 'batch_copy':
        await showTargets(selectedIds)
        return
      case 'batch_rename':
        onrenameselected?.(lists.filter((list) => selectedIds.includes(list.id) && canBatchEditList(list)).map((list) => list.id))
        break
      case 'batch_delete':
        await deleteSelected()
        break
      case 'exit_batch':
        onexitbatch?.()
        break
      case 'back':
        menuView = 'main'
        setMenu()
        menuVisible = false
        await tick()
        menuVisible = true
        return
      case 'remove':
        if (info) void removeUserList(info)
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
      if (info?.id !== _id) return
      setMenu()
    })

    return () => {
      unsub()
      fetchingListStatus.clear()
    }
  })
</script>

<Menu bind:visible={menuVisible} {menus} location={menuLocation} onclick={handleClick} {onhide} />
