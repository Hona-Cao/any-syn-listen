import type { ExtensionConfig } from '@any-listen/extension-kit/config'
const config: ExtensionConfig = {
  id: 'hona-account-sync', name: '账号歌单同步', version: '0.1.0', target_engine: '1.4.0',
  description: '网易云、QQ音乐、酷狗和 LX N 歌单同步', author: 'Hona-Cao',
  homepage: 'https://github.com/Hona-Cao/any-syn-listen', license: 'SEE LICENSE IN LICENSE',
  categories: ['music'], tags: ['sync'], grant: ['internet','music_list'],
  download_url_template: 'https://github.com/Hona-Cao/any-syn-listen/releases/download/account-sync-v{version}',
  contributes: { commands: [
    { command: 'connect', name: '连接账号助手' },
    { command: 'sync', name: '立即同步' },
    { command: 'manage', name: '歌单管理' }
  ] },
  buildConfig: { mainEntry: 'src/index.ts', srcDir: 'src', distDir: 'dist', outputDir: 'build', resourcesDir: 'resources', i18nDir: 'i18n' }
}
export default config
