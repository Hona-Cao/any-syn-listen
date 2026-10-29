<script lang="ts">
  import ListItem from './ListItem.svelte'
  import Menu from './Menu.svelte'
  import { useListItemHeight } from '@/modules/app/reactive.svelte'
  import type { Position } from '@/components/base/Menu.svelte'
  import { getAllList } from '@/modules/musicLibrary/store/actions'
  import { scrollPointerEvents } from '@/shared/compositions/scrollPointerEvents.svelte'
  import { verticalScrollbar } from '@/shared/compositions/verticalScrollbar.svelte'
  import { defaultLists, useUserList } from '@/modules/musicLibrary/reactive.svelte'
  import type { ComponentExports } from 'svelte'
  import { sortable } from '@/shared/compositions/sortable.svelte'
  import { updateUserListPosition } from './action'
  import { appState } from '@/modules/app/store/state'
  import { sendListAction } from '@/shared/ipc/list'
  import { showNotify } from '@/components/apis/notify'
  import { canBatchEditList } from './batchUtils'

  const listItemHeight = useListItemHeight(3.2)
  const picStyle = $derived(`height:${listItemHeight.val * 0.64}px; width:${listItemHeight.val * 0.64}px;`)

  let menu: ComponentExports<typeof Menu>
  const userLists = useUserList(null)
  const lists = $derived([...$defaultLists, ...userLists.val])
  let activeIndex = $state(-1)
  let batchMode = $state(false)
  let renameMode = $state(false)
  let selectedIds = $state<string[]>([])
  let draftNames = $state<Record<string, string>>({})

  const isSelectable = (item: AnyListen.List.MyListInfo) =>
    !(item.type === 'local' && item.meta.deviceId !== appState.machineId)
  const selectableLists = $derived(lists.filter(isSelectable))
  const allSelected = $derived(selectableLists.length > 0 && selectableLists.every((item) => selectedIds.includes(item.id)))

  const showMenu = (item: AnyListen.List.MyListInfo | null, position: Position) => {
    menu.show(item, position, batchMode, selectedIds)
  }

  const startBatch = (id?: string) => {
    batchMode = true
    renameMode = false
    selectedIds = id && lists.some((item) => item.id === id && isSelectable(item)) ? [id] : []
    draftNames = {}
  }

  const toggleSelected = (id: string, checked: boolean) => {
    const item = lists.find((list) => list.id === id)
    if (!batchMode || renameMode || !item || !isSelectable(item)) return
    selectedIds = checked
      ? [...selectedIds.filter((selectedId) => selectedId !== id), id]
      : selectedIds.filter((selectedId) => selectedId !== id)
  }

  const toggleAll = () => {
    selectedIds = allSelected ? [] : selectableLists.map((item) => item.id)
  }

  const exitBatch = () => {
    batchMode = false
    renameMode = false
    selectedIds = []
    draftNames = {}
  }

  const startRename = (ids: string[]) => {
    const selected = lists.filter((item) => ids.includes(item.id))
    if (!selected.length || selected.length !== ids.length || !selected.every(canBatchEditList)) {
      showNotify('请选择普通自建歌单')
      return
    }
    batchMode = true
    renameMode = true
    selectedIds = [...ids]
    draftNames = Object.fromEntries(selected.map((item) => [item.id, item.name]))
  }

  const setDraftName = (id: string, name: string) => {
    draftNames = { ...draftNames, [id]: name }
  }

  const cancelRename = () => {
    renameMode = false
    draftNames = {}
  }

  const saveRename = async () => {
    const selected = lists.filter((item) => selectedIds.includes(item.id) && canBatchEditList(item))
    const changes: AnyListen.List.MyListInfo[] = []
    for (const item of selected) {
      const name = (draftNames[item.id] ?? item.name).trim()
      if (!name) {
        showNotify('歌单名称不能为空')
        return
      }
      if (name !== item.name) {
        changes.push({ ...item, name, meta: { ...item.meta, updateTime: Date.now() } } as AnyListen.List.MyListInfo)
      }
    }
    if (!changes.length) {
      showNotify('没有修改')
      exitBatch()
      return
    }
    try {
      await sendListAction({ action: 'list_update', data: { lists: changes } })
      showNotify(`已修改 ${changes.length} 个歌单`)
      exitBatch()
    } catch (error) {
      showNotify(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
</script>

<div class="my-lists-panel">
  {#if batchMode}
    <div class="batch-toolbar">
      {#if renameMode}
        <span>编辑 {selectedIds.length} 个歌单</span>
        <div class="batch-actions">
          <button type="button" onclick={saveRename}>保存</button>
          <button type="button" onclick={cancelRename}>取消</button>
        </div>
      {:else}
        <span>已选 {selectedIds.length}</span>
        <div class="batch-actions">
          <button type="button" onclick={toggleAll}>{allSelected ? '取消全选' : '全选'}</button>
          <button type="button" onclick={exitBatch}>完成</button>
        </div>
      {/if}
    </div>
  {/if}
  {#await getAllList()}
    <div class="list-container tip">Loading...</div>
  {:then _}
    <div
      class="list-container my-list-container"
      role="list"
      tabindex="-1"
      {@attach scrollPointerEvents}
      {@attach verticalScrollbar({ offset: '0', scrollbarWidth: '0.375rem' })}
      oncontextmenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (renameMode) return
        activeIndex = -1
        showMenu(null, { x: event.pageX, y: event.pageY })
      }}
    >
      <ul
        class="list"
        {@attach sortable({
          onupdate: (parentId, id, toTargetId, position) => {
            if (batchMode) return
            void updateUserListPosition(id, position - $defaultLists.length)
          },
          filter: batchMode ? '.draggable-item' : '.default-list',
          activeElement: 'my-list-container',
        })}
      >
        {#each lists as item, index (item.id)}
          <li class="list-item draggable-item" class:default-list={item.type === 'default'} data-id={item.id}>
            <ListItem
              listInfo={item}
              active={activeIndex === index}
              {index}
              {picStyle}
              batchMode={batchMode}
              selected={selectedIds.includes(item.id)}
              selectionDisabled={renameMode || !isSelectable(item)}
              editing={renameMode && selectedIds.includes(item.id)}
              editName={draftNames[item.id] ?? item.name}
              onToggleSelect={toggleSelected}
              onEditName={setDraftName}
              oncontextmenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (renameMode) return
                activeIndex = index
                if (batchMode && !selectedIds.includes(item.id) && isSelectable(item)) {
                  selectedIds = [...selectedIds, item.id]
                }
                showMenu(item, { x: event.pageX, y: event.pageY })
              }}
            />
          </li>
        {/each}
      </ul>
    </div>
  {:catch error}
    <div class="list-container tip">Load failed: {error.message}</div>
  {/await}
</div>
<Menu
  bind:this={menu}
  onhide={() => {
    activeIndex = -1
  }}
  onstartbatch={startBatch}
  onselectall={toggleAll}
  onexitbatch={exitBatch}
  onrenameselected={startRename}
  onbatchcomplete={exitBatch}
/>

<style lang="less">
  .my-lists-panel {
    position: relative;
    display: flex;
    flex-flow: column nowrap;
    height: 100%;
    min-height: 0;
  }
  .list-container {
    position: relative;
    display: block;
    flex: auto;
    min-height: 0;
    contain: strict;
  }
  .list {
    position: relative;
    height: 100%;
  }
  .list-item {
    padding: 0 6px;
    -webkit-user-drag: revert-layer;
  }
  .batch-toolbar {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 12px;
    font-size: 12px;
    color: var(--color-font-label);
  }
  .batch-actions {
    display: flex;
    gap: 8px;
    button {
      padding: 3px 6px;
      border: 0;
      border-radius: @radius-border;
      background: transparent;
      color: var(--color-primary);
      cursor: pointer;
      &:hover { background: var(--color-primary-background-hover); }
    }
  }
  .tip {
    align-items: center;
    justify-content: center;
  }
</style>
