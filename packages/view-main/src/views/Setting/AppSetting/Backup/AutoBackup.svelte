<script lang="ts">
  import { t } from '@/plugins/i18n'
  import TitleContent from '../../components/TitleContent.svelte'
</script>

<TitleContent name={$t('settings.backup.auto_backup_title')}>
  <div class="settings-item-content">
    <p>本 LX-N 单文件测试版已停用本地数据库的定时、启动和数据变更自动备份，不会创建新的 db_backups 文件。</p>
    <p>已存在的历史备份不会被软件自动删除。数据库或配置文件损坏时，程序会保留原文件并停止操作，而不是自动生成备份或重建。</p>
    <p>手动导出歌单仍可在「备份与恢复」中按需执行；运行所必需的 SQLite 数据库及 WAL 临时文件不是历史备份。</p>
  </div>
</TitleContent>

<style lang="less">
  .settings-item-content {
    display: flex;
    flex-flow: column nowrap;
    gap: 8px;
    font-size: 13px;
  }
</style>
