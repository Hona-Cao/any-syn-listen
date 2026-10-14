<script lang="ts">
  import { t } from '@/plugins/i18n'
  import { loginNeteaseInWindow } from '@/shared/ipc/app'
  import TitleContent from '../components/TitleContent.svelte'
  import { useSettingValue } from '@/modules/setting/reactive.svelte'
  import { updateSetting } from '@/modules/setting/store/action'
  import Checkbox from '@/components/base/Checkbox.svelte'
  import { runSyncWebDAV } from '@/shared/ipc/sync'
  import Input from '@/components/base/Input.svelte'
  import { settingState } from '@/modules/setting/store/state'
  import { useSyncWebDAVState } from '@/modules/sync/reactive.svelte'
  import { dateFormat } from '@/shared'
  import { showDataMergeModeModal } from '@/components/apis/dataMergeModeModal'
  import Btn from '@/components/base/Btn.svelte'
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
  let neteaseEnable = $state(settingState.setting['sync.netease.enable'])
  let neteaseCookie = $state(settingState.setting['sync.netease.cookie'])
  let neteaseLoginMessage = $state('')
  let lxEnable = $state(settingState.setting['sync.lxWebdav.enable'])
  let lxPath = $state(settingState.setting['sync.lxWebdav.path'])

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
      <Checkbox
        label="同步 LX N Music 歌单（只读导入，单独创建镜像）"
        id="sync.lxWebdav.enable"
        checked={lxEnable}
        onchange={(val) => {
          lxEnable = val
          void updateSetting({ 'sync.lxWebdav.enable': val })
        }}
      />
    </div>
    {#if lxEnable}
      <div class="gap-top">
        <Input
          id="sync.lxWebdav.path"
          class="input-url"
          placeholder="LX N Music 目录，例如 /LX_Music/"
          value={lxPath}
          onchange={(val) => { lxPath = val }}
          onblur={() => { void updateSetting({ 'sync.lxWebdav.path': lxPath }) }}
        />
        <p class="small">使用上方 WebDAV 服务器和凭据；每 3 分钟检查一次 playlists.json。此功能不会覆盖 AnyListen 原有列表。</p>
      </div>
    {/if}
    <div class="gap-top">
      <Checkbox
        label="网易云账号歌单与每日推荐（只读同步）"
        id="sync.netease.enable"
        checked={neteaseEnable}
        onchange={(val) => {
          neteaseEnable = val
          void updateSetting({ 'sync.netease.enable': val })
        }}
      />
    </div>
    {#if import.meta.env.VITE_IS_DESKTOP}
      <div class="gap-top">
        <Btn
          onclick={async () => {
            neteaseLoginMessage = ''
            try {
              const success = await loginNeteaseInWindow()
              neteaseLoginMessage = success
                ? '登录成功。凭据已在本机加密保存，将按低频率自动检查及续期。'
                : '已关闭登录窗口，没有更改原来的登录状态。'
              if (success) {
                neteaseEnable = true
                neteaseCookie = ''
              }
            } catch (err) {
              neteaseLoginMessage = (err as Error).message
            }
          }}
        >打开网易云官方登录页面（自动获取 Cookie）</Btn>
      </div>
      {#if neteaseLoginMessage}
        <p class="small">{neteaseLoginMessage}</p>
      {/if}
    {/if}
    {#if neteaseEnable}
      <div class="gap-top">
        <Input
          id="sync.netease.cookie"
          class="input-url"
          type="password"
          placeholder="手动 Cookie（可选：系统加密存储不可用时备用）"
          value={neteaseCookie}
          onchange={(val) => { neteaseCookie = val }}
          onblur={() => { void updateSetting({ 'sync.netease.cookie': neteaseCookie }) }}
        />
        <p class="small">手动输入的 Cookie 将保存在本机应用配置中（未额外加密）。桌面端建议使用上方的官方登录窗口。自动同步账号歌单约每三小时一次，续期最多每十八小时尝试一次；不保证永不过期。</p>
      </div>
    {/if}
    <div class="gap-top">
      <Btn disabled={disabledSyncBtn} onclick={runSync}>{$t('settings.dataSync.webdav_sync')}</Btn>
    </div>
    <div class="gap-top">
      {#if webdavStateText}
        <p class="small">{webdavStateText}</p>
      {/if}
    </div>
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
