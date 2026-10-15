<script lang="ts">
  import { t } from '@/plugins/i18n'
  import { loginNeteaseInWindow, loginQQMusicInWindow, loginKugouInWindow } from '@/shared/ipc/app'
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
  let neteaseLoginBusy = $state(false)
  let qqEnable = $state(settingState.setting['sync.qq.enable'])
  let qqMessage = $state('')
  let qqLoginBusy = $state(false)
  let kugouEnable = $state(settingState.setting['sync.kugou.enable'])
  let kugouMessage = $state('')
  let kugouLoginBusy = $state(false)
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
        label="LX N 歌单同步"
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
          placeholder="LX N 目录 /LX_Music/"
          value={lxPath}
          onchange={(val) => { lxPath = val }}
          onblur={() => { void updateSetting({ 'sync.lxWebdav.path': lxPath }) }}
        />
      </div>
    {/if}
    {#if !import.meta.env.VITE_IS_DESKTOP}
      <div class="gap-top">
        <Checkbox
          label="网易云歌单同步"
          id="sync.netease.enable"
          checked={neteaseEnable}
          onchange={(val) => {
            neteaseEnable = val
            void updateSetting({ 'sync.netease.enable': val })
          }}
        />
      </div>
      {#if neteaseEnable}
        <Input
          id="sync.netease.cookie"
          class="input-url"
          type="password"
          placeholder="网易云 Cookie"
          value={neteaseCookie}
          onchange={(val) => { neteaseCookie = val }}
          onblur={() => { void updateSetting({ 'sync.netease.cookie': neteaseCookie }) }}
        />
      {/if}
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

{#if import.meta.env.VITE_IS_DESKTOP}
  <TitleContent name="音乐平台账号">
    <div class="settings-item-content">
      <div class="account-line">
        <span class="account-platform">网易云音乐</span>
        <Btn
          disabled={neteaseLoginBusy}
          onclick={async () => {
            if (neteaseLoginBusy) return
            neteaseLoginBusy = true
            neteaseLoginMessage = ''
            try {
              const loggedIn = await loginNeteaseInWindow()
              if (loggedIn) {
                neteaseEnable = true
                neteaseLoginMessage = '登录成功'
              }
            } catch (error) {
              neteaseLoginMessage = (error as Error).message
            } finally {
              neteaseLoginBusy = false
            }
          }}
        >{neteaseLoginBusy ? '登录中…' : '登录'}</Btn>
        <span class="account-status">{neteaseLoginMessage || (neteaseEnable ? '同步已启用' : '未登录')}</span>
      </div>
      <div class="account-line">
        <span class="account-platform">QQ 音乐</span>
        <Btn
          disabled={qqLoginBusy}
          onclick={async () => {
            if (qqLoginBusy) return
            qqLoginBusy = true
            qqMessage = ''
            try {
              const loggedIn = await loginQQMusicInWindow()
              if (loggedIn) {
                qqEnable = true
                qqMessage = '登录成功'
              }
            } catch (error) {
              qqMessage = (error as Error).message
            } finally {
              qqLoginBusy = false
            }
          }}
        >{qqLoginBusy ? '登录中…' : '登录'}</Btn>
        <span class="account-status">{qqMessage || (qqEnable ? '同步已启用' : '未登录')}</span>
      </div>
      <div class="account-line">
        <span class="account-platform">酷狗音乐</span>
        <Btn
          disabled={kugouLoginBusy}
          onclick={async () => {
            if (kugouLoginBusy) return
            kugouLoginBusy = true
            kugouMessage = ''
            try {
              const loggedIn = await loginKugouInWindow()
              if (loggedIn) {
                kugouEnable = true
                kugouMessage = '登录成功'
              }
            } catch (error) {
              kugouMessage = (error as Error).message
            } finally {
              kugouLoginBusy = false
            }
          }}
        >{kugouLoginBusy ? '登录中…' : '登录'}</Btn>
        <span class="account-status">{kugouMessage || (kugouEnable ? '同步已启用' : '未登录')}</span>
      </div>
    </div>
  </TitleContent>
{/if}


<style lang="less">
  .account-line {
    display: flex;
    flex-flow: row wrap;
    gap: 16px;
    align-items: center;
    padding: 6px 0;
  }
  .account-platform { width: 100px; }
  .account-status { opacity: 0.7; }
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
