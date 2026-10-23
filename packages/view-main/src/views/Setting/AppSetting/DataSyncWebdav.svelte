<script lang="ts">
  import { t } from '@/plugins/i18n'
  import TitleContent from '../components/TitleContent.svelte'
  import { useSettingValue } from '@/modules/setting/reactive.svelte'
  import { updateSetting } from '@/modules/setting/store/action'
  import Checkbox from '@/components/base/Checkbox.svelte'
  import { runSyncWebDAV, runLXNSync } from '@/shared/ipc/sync'
  import Input from '@/components/base/Input.svelte'
  import { settingState } from '@/modules/setting/store/state'
  import { useSyncWebDAVState } from '@/modules/sync/reactive.svelte'
  import { dateFormat } from '@/shared'
  import { showDataMergeModeModal } from '@/components/apis/dataMergeModeModal'
  import Btn from '@/components/base/Btn.svelte'
  const lxnEnable = useSettingValue('sync.lxn.enable')
  const lxnWriteEnabled = useSettingValue('sync.lxn.writeEnabled')
  let lxnPath = $state(settingState.setting['sync.lxn.path'])
  let lxnBusy = $state(false)
  let lxnMessage = $state('')
  const syncLXNow = async () => {
    lxnBusy = true
    lxnMessage = ''
    try {
      const result = await runLXNSync()
      lxnMessage = result.action === 'downloaded' ? '已从 LX-N 下载歌单' :
        result.action === 'uploaded' ? '已上传歌单到 LX-N' : '歌单已是最新'
    } catch (err) {
      lxnMessage = err instanceof Error ? err.message : String(err)
    } finally {
      lxnBusy = false
    }
  }
  const webdavEnable = useSettingValue('sync.webdav.enable')
  const webdavDebugEnable = useSettingValue('sync.webdav.debugEnable')
  const webdavUrl = useSettingValue('sync.webdav.url')
  const webdavUsername = useSettingValue('sync.webdav.username')
  const webdavPath = useSettingValue('sync.webdav.path')
  const webdavState = useSyncWebDAVState()

  let disabled = $derived(!webdavUrl.val || !webdavUsername.val || !webdavPath.val)
  let disabledSyncBtn = $derived(disabled || (webdavState.val.status !== 'idle' && webdavState.val.status !== 'error'))

  let webdavStateText = $derived.by(() => {
    switch (webdavState.val.status) {
      case 'idle':
        if (!webdavEnable.val) return ''
        return $t('settings.dataSync.webdav_state_idle', {
          time: webdavState.val.nextSyncTime ? dateFormat(webdavState.val.nextSyncTime) : '-',
        })
      case 'syncing':
        return $t('settings.dataSync.webdav_state_syncing')
      case 'error':
        return $t('settings.dataSync.webdav_state_error', { msg: webdavState.val.error || 'Unknown error' })
      case 'waiting':
        return $t('settings.dataSync.webdav_state_waiting')
    }
    return ''
  })

  let url = $state(settingState.setting['sync.webdav.url'])
  let path = $state(settingState.setting['sync.webdav.path'])
  let username = $state(settingState.setting['sync.webdav.username'])
  let password = $state(settingState.setting['sync.webdav.password'])
  let enableList = $state(settingState.setting['sync.webdav.syncEnable.list'])
  let enableDislike = $state(settingState.setting['sync.webdav.syncEnable.dislike'])

  const runSync = async () => {
    await runSyncWebDAV(
      async () => {
        return showDataMergeModeModal('list')
      },
      async () => {
        return showDataMergeModeModal('dislike')
      }
    ).catch((err) => {
      console.error(err)
    })
  }
  const handleEnableWebdav = async (enabled: boolean) => {
    if (enabled) await runSync()
    await updateSetting({ 'sync.webdav.enable': enabled })
  }
</script>

<TitleContent name={$t('settings.dataSync.webdav')}>
  <div class="settings-item-content">
    <div class="gap-top">
      <Checkbox
        label={$t('settings.dataSync.webdav_enable')}
        id="settings.dataSync.webdav_enable"
        checked={webdavEnable.val}
        onchange={handleEnableWebdav}
        {disabled}
      />
    </div>
    <div class="gap-top">
      <Checkbox
        label={$t('settings.dataSync.webdav_debug_enable')}
        id="settings.dataSync.webdav_debug_enable"
        checked={webdavDebugEnable.val}
        onchange={async (enabled) => updateSetting({ 'sync.webdav.debugEnable': enabled })}
      />
    </div>
    <div class="gap-top">
      <Input
        id="settings.dataSync.webdav.url"
        class="input-url"
        placeholder={$t('settings.dataSync.webdav_url_placeholder')}
        value={url}
        type="url"
        disabled={webdavEnable.val}
        onchange={(val) => {
          url = val
        }}
        onblur={() => {
          void updateSetting({ 'sync.webdav.url': url })
        }}
      />
    </div>
    <div class="gap-top">
      <Input
        id="settings.dataSync.webdav.path"
        class="input-url"
        placeholder={$t('settings.dataSync.webdav_path_placeholder')}
        value={path}
        disabled={webdavEnable.val}
        onchange={(val) => {
          path = val
        }}
        onblur={() => {
          void updateSetting({ 'sync.webdav.path': path })
        }}
      />
    </div>
    <div class="gap-top">
      <Input
        id="settings.dataSync.webdav.username"
        placeholder={$t('settings.dataSync.webdav_username_placeholder')}
        value={username}
        disabled={webdavEnable.val}
        onchange={(val) => {
          username = val
        }}
        onblur={() => {
          void updateSetting({ 'sync.webdav.username': username })
        }}
      />
      <Input
        id="settings.dataSync.webdav.password"
        placeholder={$t('settings.dataSync.webdav_password_placeholder')}
        value={password}
        type="password"
        disabled={webdavEnable.val}
        onchange={(val) => {
          password = val
        }}
        onblur={() => {
          void updateSetting({ 'sync.webdav.password': password })
        }}
      />
    </div>
    <div class="gap-top">
      <Checkbox
        label={$t('settings.dataSync.webdav_syncEnable_list')}
        id="settings.dataSync.webdav_syncEnable_list"
        checked={enableList}
        onchange={(val) => {
          enableList = val
          void updateSetting({ 'sync.webdav.syncEnable.list': val })
        }}
      />
    </div>
    <div class="gap-top">
      <Checkbox
        label={$t('settings.dataSync.webdav_syncEnable_dislike')}
        id="settings.dataSync.webdav_syncEnable_dislike"
        checked={enableDislike}
        onchange={(val) => {
          enableDislike = val
          void updateSetting({ 'sync.webdav.syncEnable.dislike': val })
        }}
      />
    </div>
    <div class="gap-top">
      <Btn disabled={disabledSyncBtn} onclick={runSync}>{$t('settings.dataSync.webdav_sync')}</Btn>
    </div>
    <div class="gap-top">
      {#if webdavStateText}
        <p class="small">{webdavStateText}</p>
      {/if}
    </div>
  </div>
  <div class="settings-item-content">
    <h3>LX-N 手机端歌单互通</h3>
    <p class="small">独立于 Any Listen 快照同步。复用上面的 WebDAV 服务器与账号，首次同步只读取手机端数据。只操作「LX-N ·」镜像歌单，不覆盖原有收藏。</p>
    <div class="gap-top">
      <Checkbox label="启用 LX-N 同步" id="settings.sync.lxn.enable" checked={lxnEnable.val}
        onchange={async (val) => updateSetting({ 'sync.lxn.enable': val })}/>
    </div>
    <div class="gap-top">
      <Input id="settings.sync.lxn.path" class="input-url" value={lxnPath}
        placeholder="/LX_Music/" onchange={(val) => { lxnPath = val }}
        onblur={() => { void updateSetting({ 'sync.lxn.path': lxnPath }) }}/>
    </div>
    <div class="gap-top">
      <Checkbox label="允许双向写入（修改 LX-N 镜像歌单将上传至手机端 WebDAV）"
        id="settings.sync.lxn.write" checked={lxnWriteEnabled.val}
        onchange={async (val) => updateSetting({ 'sync.lxn.writeEnabled': val })}/>
    </div>
    <div class="gap-top">
      <Btn disabled={!lxnEnable.val || !webdavUrl.val || !webdavUsername.val || lxnBusy}
        onclick={syncLXNow}>{lxnBusy ? '同步中…' : '立即同步 LX-N'}</Btn>
    </div>
    {#if lxnMessage}
      <p class="small" role="status">{lxnMessage}</p>
    {/if}
    <p class="small">注意：若两端同时修改，程序会拒绝覆盖。普通 WebDAV 无法保证原子写入；首次使用请备份手机端 playlists.json。</p>
  </div>
</TitleContent>

<style lang="less">
  .gap-top {
    display: flex;
    flex-flow: row nowrap;
    gap: 20px;
    align-items: center;

    :global(.input-url) {
      width: 500px;
      max-width: 100%;
    }
  }
</style>
