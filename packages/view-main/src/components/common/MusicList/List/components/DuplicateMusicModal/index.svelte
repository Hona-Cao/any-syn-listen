<script lang="ts">
  import VirtualizedList from '@/components/base/VirtualizedList.svelte'
  import Modal from '@/components/material/Modal.svelte'
  import Btn from '@/components/base/Btn.svelte'
  import { useListItemHeight } from '@/modules/app/reactive.svelte'
  import { getListMusics, removeListMusics } from '@/modules/musicLibrary/actions'
  import { settingState } from '@/modules/setting/store/state'
  import { showSimpleConfirmModal } from '@/components/apis/dialog'
  import { showNotify } from '@/components/apis/notify'
  import { workers } from '@/worker'
  import { appState } from '@/modules/app/store/state'
  import type { DuplicateMusicItem } from '@/worker/main/list'
  import type { ListInfo } from '../../../type'
  import { playLocalListMusic } from '../../action'
  import Empty from '@/components/material/Empty.svelte'
  import ListItem from './ListItem.svelte'
  import { buildDuplicateRemovalPlan, duplicateListFingerprint, type DuplicateKeepRule } from './dedupe'

  let {
    visible = $bindable(),
    listinfo,
  }: {
    visible: boolean
    listinfo: ListInfo
  } = $props()

  let duplicateList = $state.raw<DuplicateMusicItem[]>([])
  let strategy = $state<DuplicateKeepRule>('quality')
  let busy = $state(false)
  let loading = $state(false)
  let fingerprint = ''
  let requestId = 0

  const listItemHeight = useListItemHeight(3.2)
  const isReadOnly = $derived(
    listinfo.type === 'online' || listinfo.type === 'remote' ||
    (listinfo.type === 'local' && listinfo.listMeta.deviceId !== appState.machineId)
  )
  const plan = $derived(
    buildDuplicateRemovalPlan(duplicateList, strategy, settingState.setting['list.addMusicLocationType'])
  )
  const removeIds = $derived(new Set(plan.removeIds))
  const keepIds = $derived(new Set(plan.keepIds))

  const refresh = async () => {
    const request = ++requestId
    loading = true
    try {
      const musics = await getListMusics(listinfo.id, true)
      const duplicates = await workers.main.filterDuplicateMusic(musics)
      if (request !== requestId || !visible) return
      fingerprint = duplicateListFingerprint(musics)
      duplicateList = duplicates
    } catch (error) {
      if (request === requestId && visible) {
        showNotify('重复歌曲检测失败：' + (error instanceof Error ? error.message : String(error)))
      }
    } finally {
      if (request === requestId) loading = false
    }
  }

  const handleRemove = async (index: number) => {
    if (busy || loading || isReadOnly) return
    busy = true
    try {
      const music = duplicateList[index]?.musicInfo
      if (!music) return
      await removeListMusics(listinfo.id, [music.id])
      await refresh()
    } catch (error) {
      showNotify('删除失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      busy = false
    }
  }

  const handleDedupe = async () => {
    if (busy || loading || isReadOnly || !plan.removeIds.length) return
    const ids = [...plan.removeIds]
    const currentFingerprint = fingerprint
    const ruleName = strategy === 'quality' ? '最高音质' : strategy === 'earliest' ? '最早加入' : '最晚加入'
    const fallbackNote = strategy !== 'quality' && plan.timeFallbackGroups
      ? ' 部分歌曲没有加入时间，将按当前歌单顺序推断。' : ''
    const confirmed = await showSimpleConfirmModal(
      '按“' + ruleName + '”保留歌曲，删除 ' + ids.length + ' 首重复项？' + fallbackNote,
      { confirmBtn: '确认去重' }
    )
    if (!confirmed || !visible) return
    busy = true
    try {
      const freshList = await getListMusics(listinfo.id, true)
      if (currentFingerprint !== duplicateListFingerprint(freshList)) {
        showNotify('歌单内容已变化，请重新确认')
        await refresh()
        return
      }
      const freshDuplicates = await workers.main.filterDuplicateMusic(freshList)
      const freshPlan = buildDuplicateRemovalPlan(
        freshDuplicates, strategy, settingState.setting['list.addMusicLocationType']
      )
      if (ids.length !== freshPlan.removeIds.length ||
        ids.some((id, index) => id !== freshPlan.removeIds[index])) {
        showNotify('去重结果已变化，请重新确认')
        await refresh()
        return
      }
      await removeListMusics(listinfo.id, ids)
      await refresh()
      showNotify('已删除 ' + ids.length + ' 首重复歌曲')
    } catch (error) {
      showNotify('去重失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      busy = false
    }
  }

  const handlePlay = (index: number) => {
    const music = duplicateList[index]?.musicInfo
    if (music) void playLocalListMusic(listinfo.id, music)
  }

  $effect(() => {
    if (visible) {
      void refresh()
    } else {
      requestId++
      duplicateList = []
      fingerprint = ''
      busy = false
      strategy = 'quality'
    }
  })
</script>

<Modal bind:visible bgclose teleport="#view" width="65%" maxwidth="56rem" maxheight="80%">
  <div class="header">
    <h2>{listinfo.name}</h2>
    <div class="dedupe-actions">
      <select bind:value={strategy} aria-label="去重策略" disabled={busy || loading || isReadOnly}>
        <option value="quality">保留最高音质</option>
        <option value="earliest">保留最早加入</option>
        <option value="latest">保留最晚加入</option>
      </select>
      <Btn middle disabled={isReadOnly || loading || busy || !plan.removeIds.length}
        onclick={handleDedupe}>
        {busy ? '处理中…' : loading ? '检测中…' : '去重（' + plan.removeIds.length + '）'}
      </Btn>
    </div>
  </div>
  <div class="main">
    {#if duplicateList.length}
      <VirtualizedList
        list={duplicateList}
        keyname="id"
        containerclass="list"
        itemheight={listItemHeight.val}
        contain="content"
        scrollbaroffset="0"
      >
        {#snippet row(item, index)}
          <ListItem
            info={item}
            decision={keepIds.has(item.id) ? 'keep' : removeIds.has(item.id) ? 'remove' : undefined}
            onplay={() => handlePlay(index)}
            onremove={isReadOnly || busy || loading ? undefined : async () => handleRemove(index)}
          />
        {/snippet}
      </VirtualizedList>
    {:else}
      <Empty />
    {/if}
  </div>
</Modal>

<style lang="less">
  .header {
    flex: none;
    display: flex;
    flex-flow: column nowrap;
    gap: 10px;
    padding: 14px 15px 10px;
    text-align: center;
    h2 { word-break: break-all; }
  }
  .dedupe-actions {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    select {
      border: 0;
      border-radius: @form-radius;
      padding: 7px 10px;
      color: var(--color-button-font);
      background: var(--color-primary-background);
      font-size: 13px;
    }
  }
  .main {
    display: flex;
    flex: auto;
    flex-flow: column nowrap;
    min-height: 0;
    :global(.list) {
      min-width: 460px;
      min-height: 200px;
      font-size: 13px;
      transition-property: height;
    }
  }
</style>
