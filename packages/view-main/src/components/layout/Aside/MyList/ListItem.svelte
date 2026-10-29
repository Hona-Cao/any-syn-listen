<script lang="ts">
  import SvgIcon from '@/components/base/SvgIcon.svelte'
  import Image from '@/components/base/Image.svelte'
  import type { MouseEventHandler } from 'svelte/elements'
  import { location, push, query, replace } from '@/plugins/routes'
  import { useFetchingListStatus, useListCover } from '@/modules/musicLibrary/reactive.svelte'
  import { LIST_PIC_ICON } from '@/shared/constants'

  let {
    listInfo,
    picStyle,
    active,
    oncontextmenu,
    batchMode = false,
    selected = false,
    selectionDisabled = false,
    editing = false,
    editName = '',
    onToggleSelect,
    onEditName,
  }: {
    listInfo: AnyListen.List.MyListInfo
    index: number
    active?: boolean
    picStyle: string
    oncontextmenu?: MouseEventHandler<HTMLDivElement>
    batchMode?: boolean
    selected?: boolean
    selectionDisabled?: boolean
    editing?: boolean
    editName?: string
    onToggleSelect?: (id: string, checked: boolean) => void
    onEditName?: (id: string, name: string) => void
  } = $props()

  const fetching = useFetchingListStatus(listInfo.id)
  const listCover = useListCover(listInfo)

  const handleSelect = () => {
    if (editing) return
    if (batchMode) {
      if (!selectionDisabled) onToggleSelect?.(listInfo.id, !selected)
      return
    }
    const url = `/library?id=${listInfo.id}`
    if ($location === '/library') void replace(url)
    else void push(url)
  }
</script>

<div
  class="container"
  class:active={$query.id === listInfo.id || active}
  class:fetching={fetching.val}
  class:batch-mode={batchMode}
  class:selected={batchMode && selected}
  role="button"
  aria-label={listInfo.name}
  aria-pressed={batchMode ? selected : undefined}
  data-ignore-tip
  tabindex="0"
  onkeydown={(event) => {
    if (event.target !== event.currentTarget || event.repeat || editing) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    handleSelect()
  }}
  onclick={handleSelect}
  {oncontextmenu}
>
  {#if batchMode}
    <input
      class="select-box"
      type="checkbox"
      checked={selected}
      disabled={selectionDisabled}
      aria-label="选择歌单"
      onclick={(event) => event.stopPropagation()}
      onchange={(event) => onToggleSelect?.(listInfo.id, event.currentTarget.checked)}
    />
  {/if}
  <div class="left" style={picStyle}>
    <Image src={listCover.val} icon={LIST_PIC_ICON[listInfo.id as keyof typeof LIST_PIC_ICON]} />
  </div>
  <div class="right">
    {#if editing}
      <input
        class="rename-input"
        type="text"
        maxlength="120"
        value={editName}
        aria-label="歌单名称"
        oninput={(event) => onEditName?.(listInfo.id, event.currentTarget.value)}
        onclick={(event) => event.stopPropagation()}
        onkeydown={(event) => event.stopPropagation()}
      />
    {:else}
      <span>{listInfo.name}</span>
    {/if}
    <div class="meta">
      <span><SvgIcon name="music" />{listInfo.meta.songCount}</span>
    </div>
  </div>
</div>

<style lang="less">
  .container {
    position: relative;
    display: flex;
    flex-flow: row nowrap;
    gap: 6px;
    align-items: center;
    height: 100%;
    padding: 6px;
    background-color: transparent;
    border-radius: @radius-border;
    transition: 0.3s ease;
    transition-property: color, background-color, opacity;
    &:not(.active) {
      &:hover { cursor: pointer; background-color: var(--color-primary-background-hover); }
    }
  }
  .active { background-color: var(--color-primary-background); }
  .selected { background-color: var(--color-primary-background-hover); }
  .batch-mode { cursor: pointer; }
  .fetching { opacity: 0.5; }
  .select-box {
    flex: none;
    width: 14px;
    height: 14px;
    margin: 0 2px 0 0;
    accent-color: var(--color-primary);
  }
  .left {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: @radius-border;
    :global(.pic.empty-pic) {
      color: var(--color-primary-light-100-alpha-400);
      background-color: var(--color-primary-light-200-alpha-700);
    }
  }
  .right {
    display: flex;
    flex: auto;
    flex-flow: column nowrap;
    gap: 2px;
    min-width: 0;
    font-size: 14px;
    span { .mixin-ellipsis-1(); }
  }
  .rename-input {
    width: 100%;
    min-width: 0;
    padding: 3px 5px;
    border: 1px solid var(--color-primary);
    border-radius: @radius-border;
    background: var(--color-content-background);
    color: var(--color-font);
    font-size: 13px;
  }
  .meta {
    display: flex;
    flex-flow: row nowrap;
    gap: 12px;
    font-size: 12px;
    color: var(--color-300);
  }
</style>
