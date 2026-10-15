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
  import { archiveUserLists, removeUserLists, restoreHiddenMirrors, updateUserListPosition } from './action'
  import Btn from '@/components/base/Btn.svelte'
  import { showNotify } from '@/components/apis/notify'
  // console.log(params)
  const listItemHeight = useListItemHeight(3.2)
  const picStyle = $derived(`height:${listItemHeight.val * 0.64}px; width:${listItemHeight.val * 0.64}px;`)
  // const picStyle = $derived(`height:${listItemHeight.val * 0.5}px;`)

  let menu: ComponentExports<typeof Menu>

  const userLists = useUserList(null)
  const isHidden = (item: AnyListen.List.MyListInfo) =>
    Boolean((item.meta as { archived?: boolean; externalMirrorHidden?: boolean }).archived ||
      (item.meta as { archived?: boolean; externalMirrorHidden?: boolean }).externalMirrorHidden)
  let showArchived = $state(false)
  let selectedIds = $state<string[]>([])
  let anchor = $state<string | null>(null)
  let busy = $state(false)
  const archiveCount = $derived(userLists.val.filter(isHidden).length)
  const lists = $derived([
    ...$defaultLists,
    ...userLists.val.filter(item => !isHidden(item)),
    ...(showArchived ? userLists.val.filter(isHidden) : []),
  ])
  const selectedItems = $derived(userLists.val.filter(item => selectedIds.includes(item.id)))
  let activeIndex = $state(-1)

  const selectItem = (item: AnyListen.List.MyListInfo, event: MouseEvent) => {
    const selectable = item.type === 'general'
    if (!selectable) {
      selectedIds = []
      anchor = null
      return false
    }
    if (event.shiftKey) {
      const eligible = lists.filter(list => list.type === 'general')
      const first = eligible.findIndex(list => list.id === anchor)
      const last = eligible.findIndex(list => list.id === item.id)
      if (last < 0) return false
      const begin = first >= 0 ? first : last
      const ids = eligible.slice(Math.min(begin, last), Math.max(begin, last) + 1).map(list => list.id)
      selectedIds = [...new Set([...selectedIds, ...ids])]
      anchor = anchor ?? item.id
      return true
    }
    if (event.ctrlKey || event.metaKey) {
      selectedIds = selectedIds.includes(item.id)
        ? selectedIds.filter(id => id !== item.id)
        : [...selectedIds, item.id]
      anchor = item.id
      return true
    }
    selectedIds = []
    anchor = item.id
    return false
  }
  const batch = async (action: 'archive' | 'restore' | 'remove') => {
    if (busy || !selectedItems.length) return
    busy = true
    try {
      if (action === 'archive') await archiveUserLists(selectedItems, true)
      else if (action === 'restore') {
        await archiveUserLists(selectedItems, false)
        await restoreHiddenMirrors(selectedItems)
      } else await removeUserLists(selectedItems)
      selectedIds = []
      anchor = null
    } catch (err) {
      showNotify('歌单批量操作失败：' + (err as Error).message)
    } finally {
      busy = false
    }
  }

  const showMenu = (item: AnyListen.List.MyListInfo | null, position: Position) => {
    menu.show(item, position)
  }
</script>

<div class="list">
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
        activeIndex = -1
        showMenu(null, { x: event.pageX, y: event.pageY })
      }}
      onkeydown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault()
          selectedIds = lists.filter(item => item.type === 'general').map(item => item.id)
        } else if (event.key === 'Escape') {
          selectedIds = []
          anchor = null
        }
      }}
    >
      {#if selectedItems.length}
        <div class="batch-bar">
          <span>已选 {selectedItems.length} 张</span>
          <Btn min disabled={busy} onclick={() => batch('archive')}>归档</Btn>
          <Btn min disabled={busy} onclick={() => batch('restore')}>恢复</Btn>
          <Btn min disabled={busy} onclick={() => batch('remove')}>删除</Btn>
          <Btn min disabled={busy} onclick={() => { selectedIds = [] }}>清除选择</Btn>
        </div>
      {/if}
      {#if archiveCount}
        <button class="archive-toggle" onclick={() => {
          showArchived = !showArchived
          selectedIds = []
        }}>
          {showArchived ? '收起归档/隐藏歌单' : '展开归档/隐藏歌单'}（{archiveCount}）
        </button>
      {/if}
      <ul
        class="list"
        {@attach sortable({
          onupdate: (parentId, id, toTargetId, position) => {
            void updateUserListPosition(id, position - $defaultLists.length)
          },
          filter: 'default-list',
          activeElement: 'my-list-container',
        })}
      >
        {#each lists as item, index (item.id)}
          <li class="list-item draggable-item" class:default-list={item.type == 'default'} data-id={item.id}>
            <ListItem
              listInfo={item}
              active={activeIndex == index}
              selected={selectedIds.includes(item.id)}
              onactivate={(event) => selectItem(item, event)}
              {index}
              {picStyle}
              oncontextmenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                activeIndex = index
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
/>

<style lang="less">
  .list {
    position: relative;
    height: 100%;
  }
  .list-container {
    position: relative;
    display: block;
    // outline: none;
    height: 100%;
    contain: strict;
  }
  .list-item {
    padding: 0 6px;
    -webkit-user-drag: revert-layer;
  }
  .batch-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    padding: 6px;
    font-size: 12px;
  }
  .archive-toggle {
    padding: 6px 10px;
    width: 100%;
    border: 0;
    color: var(--color-300);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .tip {
    align-items: center;
    justify-content: center;
  }
</style>
