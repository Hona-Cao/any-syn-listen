<script lang="ts">
  import { onMount } from 'svelte'
  import { t } from '@/plugins/i18n'
  import { getSavedMusicLoginState, loginNeteaseInWindow, loginQQMusicInWindow, loginKugouInWindow } from '@/shared/ipc/app'
  import TitleContent from '../components/TitleContent.svelte'
  import { useSettingValue } from '@/modules/setting/reactive.svelte'
  import { updateSetting } from '@/modules/setting/store/action'
  import Checkbox from '@/components/base/Checkbox.svelte'
  import { runSyncWebDAV, getExternalSyncState, runExternalSyncNow } from '@/shared/ipc/sync'
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
  let dailySaveHistory = $state(settingState.setting['sync.daily.saveHistory'])
  let kugouMessage = $state('')
  let kugouLoginBusy = $state(false)
  let lxEnable = $state(settingState.setting['sync.lxWebdav.enable'])
  let lxPath = $state(settingState.setting['sync.lxWebdav.path'])
  let lxWriteEnable = $state(settingState.setting['sync.lxWebdav.writeEnable'])
  let externalStates = $state<Awaited<ReturnType<typeof getExternalSyncState>> | null>(null)
  let savedAuth = $state<Awaited<ReturnType<typeof getSavedMusicLoginState>> | null>(null)
  const refreshSavedAuth = async () => {
    try { savedAuth = await getSavedMusicLoginState() }
    catch { savedAuth = null }
  }
  let refreshingProvider = $state<AnyListen.IPCSync.ExternalProvider | null>(null)

  const refreshExternalState = async () => {
    try { externalStates = await getExternalSyncState() } catch { /* older web builds have no native provider */ }
  }
  onMount(() => {
    void refreshSavedAuth()
    void refreshExternalState()
    const timer = setInterval(() => { void refreshExternalState() }, 2500)
    return () => { clearInterval(timer) }
  })
  const providerStatus = (provider: AnyListen.IPCSync.ExternalProvider, enabled: boolean, loginMessage: string) => {
    // A saved credential and a successful playlist sync are different facts.
    // A login cancellation must not be hidden behind an older sync result.
    if (loginMessage) return loginMessage
    const state = externalStates?.[provider]
    if (state?.status === 'syncing') return '正在同步歌单…'
    if (state?.status === 'error') return '歌单同步失败：' + (state.error || '未知错误')
    if (state?.status === 'success') return '歌单同步成功：' + dateFormat(state.lastSuccess)
    if (provider !== 'lx' && savedAuth && !savedAuth[provider]) return '未保存登录授权；请先点击登录'
    return enabled ? '同步已启用；账号登录状态待验证' : '同步未启用'
  }
  const savedAuthLabel = (provider: 'netease' | 'qq' | 'kugou') =>
    savedAuth?.[provider] ? '已保存授权' : '未保存授权'
  const canRefresh = (provider: 'netease' | 'qq' | 'kugou', enabled: boolean) =>
    enabled && Boolean(savedAuth?.[provider])
  const refreshProvider = async (provider: AnyListen.IPCSync.ExternalProvider, dailyOnly = false) => {
    if (refreshingProvider) return
    refreshingProvider = provider
    try {
      await runExternalSyncNow(provider, dailyOnly)
    } catch {
      // The independent provider state contains the error; don't open a modal.
    } finally {
      await refreshExternalState()
      refreshingProvider = null
    }
  }

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
    {#if lxEnable}
      <div class="gap-top">
        <Checkbox
          label="LX-N 双向同步（允许回写整库，最后写入覆盖，无自动备份）"
          id="sync.lxWebdav.writeEnable"
          checked={lxWriteEnable}
          onchange={(val) => {
            lxWriteEnable = val
            // Every off/on transition re-establishes WebDAV as the initial source.
            void updateSetting({ 'sync.lxWebdav.writeEnable': val, 'sync.lxWebdav.writeInitialized': false })
          }}
        />
      </div>
      <div class="gap-top">
        <Btn disabled={refreshingProvider !== null} onclick={() => refreshProvider('lx')}>
          {refreshingProvider === 'lx' ? '正在同步…' : '立即同步 LX-N'}
        </Btn>
        <span class="account-status">{providerStatus('lx', lxEnable, '')}</span>
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
      <div class="gap-top">
        <Checkbox label="保存每日推荐历史（每天自动归档一份）"
          id="sync.daily.saveHistory"
          checked={dailySaveHistory}
          onchange={(val) => {
            dailySaveHistory = val
            void updateSetting({ 'sync.daily.saveHistory': val })
          }}
        />
      </div>
      <div class="account-line">
        <span class="account-platform">网易云音乐</span>
        <Btn
          disabled={neteaseLoginBusy}
          onclick={async () => {
            if (neteaseLoginBusy) return
            neteaseLoginBusy = true
            neteaseLoginMessage = '正在打开官方登录窗口，请在窗口中完成授权'
            try {
              const loggedIn = await loginNeteaseInWindow()
              if (loggedIn) {
                neteaseEnable = true
                neteaseLoginMessage = '新登录已验证；歌单同步待确认'
              } else {
                neteaseLoginMessage = '登录窗口已关闭，尚未完成新的账号授权'
              }
              await refreshSavedAuth()
            } catch (error) {
              neteaseLoginMessage = '账号登录失败：' + (error as Error).message
            } finally {
              neteaseLoginBusy = false
            }
          }}
        >{neteaseLoginBusy ? '等待登录…' : '登录 / 重新登录'}</Btn>
        <Btn disabled={refreshingProvider !== null || !canRefresh('netease', neteaseEnable)} onclick={() => refreshProvider('netease')}>
          {refreshingProvider === 'netease' ? '刷新中…' : '刷新歌单与日推'}
        </Btn>
        <Btn disabled={refreshingProvider !== null || !canRefresh('netease', neteaseEnable)} onclick={() => refreshProvider('netease', true)}>
          刷新每日推荐
        </Btn>
        <span class="account-auth">{savedAuthLabel('netease')}</span>
        <span class="account-status">{providerStatus('netease', neteaseEnable, neteaseLoginMessage)}</span>
      </div>
      <div class="account-line">
        <span class="account-platform">QQ 音乐</span>
        <Btn
          disabled={qqLoginBusy}
          onclick={async () => {
            if (qqLoginBusy) return
            qqLoginBusy = true
            qqMessage = '正在打开官方登录窗口，请在窗口中完成授权'
            try {
              const loggedIn = await loginQQMusicInWindow()
              if (loggedIn) {
                qqEnable = true
                qqMessage = '新登录已验证；歌单同步待确认'
              } else {
                qqMessage = '登录窗口已关闭，尚未完成新的账号授权'
              }
              await refreshSavedAuth()
            } catch (error) {
              qqMessage = '账号登录失败：' + (error as Error).message
            } finally {
              qqLoginBusy = false
            }
          }}
        >{qqLoginBusy ? '等待登录…' : '登录 / 重新登录'}</Btn>
        <Btn disabled={refreshingProvider !== null || !canRefresh('qq', qqEnable)} onclick={() => refreshProvider('qq')}>
          {refreshingProvider === 'qq' ? '刷新中…' : '刷新歌单与日推'}
        </Btn>
        <Btn disabled={refreshingProvider !== null || !canRefresh('qq', qqEnable)} onclick={() => refreshProvider('qq', true)}>
          刷新每日推荐
        </Btn>
        <span class="account-auth">{savedAuthLabel('qq')}</span>
        <span class="account-status">{providerStatus('qq', qqEnable, qqMessage)}</span>
      </div>
      <div class="account-line">
        <span class="account-platform">酷狗音乐</span>
        <Btn
          disabled={kugouLoginBusy}
          onclick={async () => {
            if (kugouLoginBusy) return
            kugouLoginBusy = true
            kugouMessage = '正在打开官方登录窗口，请在窗口中完成授权'
            try {
              const loggedIn = await loginKugouInWindow()
              if (loggedIn) {
                kugouEnable = true
                kugouMessage = '新登录已验证；歌单同步待确认'
              } else {
                kugouMessage = '登录窗口已关闭，尚未完成新的账号授权'
              }
              await refreshSavedAuth()
            } catch (error) {
              kugouMessage = '账号登录失败：' + (error as Error).message
            } finally {
              kugouLoginBusy = false
            }
          }}
        >{kugouLoginBusy ? '等待登录…' : '登录 / 重新登录'}</Btn>
        <Btn disabled={refreshingProvider !== null || !canRefresh('kugou', kugouEnable)} onclick={() => refreshProvider('kugou')}>
          {refreshingProvider === 'kugou' ? '刷新中…' : '刷新歌单与日推'}
        </Btn>
        <Btn disabled={refreshingProvider !== null || !canRefresh('kugou', kugouEnable)} onclick={() => refreshProvider('kugou', true)}>
          刷新每日推荐
        </Btn>
        <span class="account-auth">{savedAuthLabel('kugou')}</span>
        <span class="account-status">{providerStatus('kugou', kugouEnable, kugouMessage)}</span>
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
  .account-auth { font-size: 12px; opacity: 0.8; }
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
