import type { ExtensionConfig } from '@any-listen/extension-kit/config'
const config: ExtensionConfig = {
  id: 'hona-account-sync', name: '账号歌单同步', version: '0.3.1', target_engine: '1.4.0',
  description: '网易云、QQ音乐、酷狗与 LX N 歌单同步', author: 'Hona-Cao',
  homepage: 'https://github.com/Hona-Cao/any-syn-listen', license: 'SEE LICENSE IN LICENSE',
  categories: ['music'], tags: ['sync'], grant: ['internet'],
  download_url_template: 'https://github.com/Hona-Cao/any-syn-listen/releases/download/account-sync-v{version}',
  contributes: {
    settings: [
      { field:'enabledAccounts', name:'音乐账号', description:'', type:'configCheckboxMultiple', default:['netease','qqmusic','kugou'], enumConfigFiled:'accountItems', enumFiled:'id', enumNameFiled:'name', removeable:false,
        actionCommands:['loginNetease','loginQQ','loginKugou','sync'], actionCommandNames:['网易云账号登录','QQ音乐账号登录','酷狗账号登录','立即同步'] },
      { field:'enabledLX', name:'LX N 歌单同步', description:'', type:'configCheckboxMultiple', default:['lx'], enumConfigFiled:'webdavItems', enumFiled:'id', enumNameFiled:'name', removeable:false,
        actionCommands:['configureWebdav'], actionCommandNames:['WebDAV 设置'] },

    ],
    resource: [
      {id:'wy',name:'网易云账号',resource:['songlist','songlistSearch']},
      {id:'tx',name:'QQ音乐账号',resource:['songlist','songlistSearch']},
      {id:'kg',name:'酷狗账号',resource:['songlist','songlistSearch']},
      {id:'lx',name:'LX N 歌单',resource:['songlist','songlistSearch']}
    ],
    commands: [
      {command:'loginNetease',name:'网易云账号登录'}, {command:'loginQQ',name:'QQ音乐账号登录'},
      {command:'loginKugou',name:'酷狗账号登录'}, {command:'configureWebdav',name:'WebDAV 设置'},
      {command:'sync',name:'立即同步'}, {command:'refreshLists',name:'刷新歌单'}
    ]
  },
  buildConfig: { mainEntry:'src/index.ts', srcDir:'src', distDir:'dist', outputDir:'build', resourcesDir:'resources', i18nDir:'i18n' }
}
export default config
