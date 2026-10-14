import {SyncEngine, selectableLists} from './engine.mjs'
import {CatalogEngine,registerCatalogResources} from './catalog-engine.mjs'
import {PortableClient} from './portable-client.mjs'
import {cleanMessage} from './portable-utils.mjs'

const PLATFORM_LABEL={netease:'网易云音乐',qqmusic:'QQ 音乐',kugou:'酷狗音乐'}
const SOURCES=['netease','qqmusic','kugou','lx']
const STALE_MESSAGE='未登录'
const DAV_MASK='●●●●●●●●'
export class NativeController {
  constructor(api){
    this.api=api
    this.portable=new PortableClient(api)
    this.enabled=[...SOURCES]
    this.busy=false
    this.interactive=false
    this.forceRequest=null
    this.lastResult=null
    this.lastUi=''
    this.seq=0
    this.passwordUpdate=Promise.resolve()
    this.catalogEngine=new CatalogEngine(api,params=>this.transport(params))
    this.engine=api.musicList?new SyncEngine(api,params=>this.transport(params)):this.catalogEngine
  }
  newId(){return 'native_'+Date.now().toString(36)+'_'+(++this.seq)}
  async configs(keys){return this.api.configuration.getConfigs(keys)}
  async transport(_payload){
    const cfg=this.forceRequest
    this.forceRequest=null
    const result=await this.portable.refresh(cfg?.sources??this.enabled,!!cfg?.force)
    this.lastResult=result
    return result
  }
  async refreshNative(){
    const [filter,accounts,lx]=await this.configs(['playlistFilter','enabledAccounts','enabledLX'])
    this.enabled=[
      ...(Array.isArray(accounts)?accounts:['netease','qqmusic','kugou']),
      ...(Array.isArray(lx)?lx:['lx'])
    ]
    const all=this.api.musicList?
      selectableLists(await this.api.musicList.getAllUserLists()):
      await this.catalogEngine.refreshIndex()
    const query=String(filter||'').trim().toLocaleLowerCase()
    this.visible=all.filter(x=>!query||x.name.toLocaleLowerCase().includes(query))
    const backend=this.portable.getState()
    const label=Object.entries(PLATFORM_LABEL).map(([id,name])=>{
      const status=backend.accounts[id]||{}
      const count=all.filter(x=>String(x.meta?.externalMirror??'').startsWith(id+':')).length
      return {id,name:name+'  ·  '+(status.stage==='syncing'?'同步中':
        status.stage==='error'?'同步失败':status.stage==='authorizing'?'等待扫码':status.stage==='scanned'?'已扫码，待确认':status.stage==='validating'?'验证账号中':count?count+' 个歌单':
          status.connected?'已登录':STALE_MESSAGE)}
    })
    const ui={
      accountItems:label,
      webdavItems:[{id:'lx',name:'LX N Music  ·  '+(backend.webdav?.configured?'已连接':'未连接')}],
      playlistItems:this.visible.map(x=>({id:x.id,name:x.name})),
      archiveItems:this.engine.state.archives.filter(x=>!x.restoredAt).map(x=>({
        id:x.id,name:(x.kind==='delete'?'回收站':'归档')+' · '+(x.names?.slice(0,2).join('、')??'歌单')
      }))
    }
    const sig=JSON.stringify(ui)
    if(sig!==this.lastUi){this.lastUi=sig;await this.api.configuration.setConfigs(ui)}
  }
  async tick(){
    if(this.busy)return
    this.busy=true
    try{
      await this.refreshNative()
      if(this.engine!==this.catalogEngine)await this.engine.cycle()
      await this.catalogEngine.cycle()
      await this.refreshNative()
    }catch(e){
      this.api.logcat?.warn?.('账号歌单后台刷新失败：'+cleanMessage(e))
    }finally{this.busy=false}
  }
  async importSource(source){
    this.forceRequest={sources:[source],force:true}
    await this.catalogEngine.cycle()
    await this.refreshNative()
    const state=source==='lx'?this.portable.getState().webdav:this.portable.getState().accounts[source]
    if(state?.stage==='error')throw new Error(state.error??'歌单读取失败')
  }
  async login(source){
    let success=false
    try{
      success=await this.portable.login(source,stage=>{
        this.portable.status[source]={connected:false,stage}
        void this.refreshNative().catch(()=>{})
      })
    }catch(error){
      this.portable.status[source]={connected:false,stage:'error',error:cleanMessage(error)}
      await this.refreshNative()
      throw error
    }
    if(!success){
      this.portable.status[source]={connected:false,stage:'idle'}
      await this.refreshNative()
      return
    }
    await this.api.app.showMessage('登录成功')
    try{await this.importSource(source)}
    catch(e){await this.api.app.showMessage('账号已登录，歌单暂时未同步：'+cleanMessage(e),{type:'warning'})}
  }
  async webLogin(source){
    const urls={
      netease:'https://music.163.com/#/login',
      qqmusic:'https://y.qq.com/n/ryqq/profile',
      kugou:'https://www.kugou.com/'
    }
    const buttons=[
      {text:'取消'},
      {text:'打开官网',link:urls[source]},
      {text:'导入登录状态'}
    ]
    const choice=await this.api.app.showMessage('请先在平台官方网站登录。官方 AnyListen 扩展暂不能自动读取浏览器 Cookie。',{modal:true,buttons})
    if(choice===2)await this.importCookie(source)
  }
  async importAccountState(){
    const select=await this.api.app.showMessage('选择平台，然后粘贴在该平台登录后得到的 Cookie。',{
      modal:true,buttons:[{text:'取消'},{text:'网易云'},{text:'QQ音乐'},{text:'酷狗'}]
    })
    if(select<=0||select>3)return
    const platforms=['netease','qqmusic','kugou']
    await this.importCookie(platforms[select-1])
  }
  async importCookie(source){
    const label=PLATFORM_LABEL[source]
    const state=await this.api.app.showInputDialog({
      title:label+' · 导入登录状态',placeholder:'粘贴该平台登录后的 Cookie',
      password:true
    })
    if(!state)return
    await this.portable.importCookie(source,state)
    try{
      await this.importSource(source)
      await this.api.app.showMessage('登录成功，歌单已同步')
    }catch(e){
      await this.api.app.showMessage('登录状态已导入，但歌单暂时无法读取：'+cleanMessage(e),{type:'warning'})
    }
  }
  async neteaseLogin(){
    // Native login window stays in AnyListen. The QR is issued and checked by
    // NetEase: no browser cookie scraping, companion EXE or manual tokens.
    return this.login('netease')
  }
  async captureWebdavPassword(){
    const [value]=await this.configs(['webdavPassword'])
    if(typeof value==='string' && value && value!==DAV_MASK){
      this.portable.pendingDAVPassword=value
      await this.api.configuration.setConfigs({webdavPassword:DAV_MASK})
    }
  }
  async configureWebdav(){
    await this.passwordUpdate
    await this.captureWebdavPassword()
    const [url,username,folder]=await this.configs(['webdavUrl','webdavUsername','webdavFolder'])
    const password=this.portable.pendingDAVPassword??this.portable.webdav?.password
    if(!url||!username||!password)throw new Error('请填写 WebDAV 地址、用户名和应用密码')
    await this.portable.configureDAV({url,username,password,folder:folder||'/LX_Music'})
    this.portable.pendingDAVPassword=null
    await this.api.configuration.setConfigs({webdavPassword:DAV_MASK})
    await this.api.app.showMessage('WebDAV 已连接')
    try{await this.importSource('lx')}
    catch(e){await this.api.app.showMessage('设置已保存，但歌单暂时未同步：'+cleanMessage(e),{type:'warning'})}
  }
  async clearWebdav(){
    const choice=await this.api.app.showMessage('断开 WebDAV 连接？不会删除已导入的歌单。',{
      modal:true,buttons:[{text:'取消'},{text:'断开'}]
    })
    if(choice!==1)return
    await this.portable.clearDAV()
    this.portable.pendingDAVPassword=null
    await this.api.configuration.setConfigs({webdavUrl:'',webdavUsername:'',webdavFolder:'/LX_Music',webdavPassword:''})
    await this.refreshNative()
    await this.api.app.showMessage('已断开 WebDAV')
  }
  async sync(){
    const connected=this.enabled.filter(id=>this.portable.isConnected(id))
    if(!connected.length)throw new Error('请先登录账号或设置 WebDAV')
    this.forceRequest={sources:connected,force:true}
    await this.catalogEngine.cycle()
    await this.refreshNative()
    const errors=connected.filter(id=>(id==='lx'?this.portable.status.lx:this.portable.status[id])?.stage==='error')
    if(errors.length)throw new Error('以下平台暂时无法同步：'+errors.map(id=>
      PLATFORM_LABEL[id]??'LX N').join('、'))
    await this.api.app.showMessage('同步完成')
  }
  async manage(kind){
    if(!this.api.musicList)throw new Error('当前 AnyListen 尚未开放本地歌单批量管理接口')
    const [selection]=await this.configs(['selectedPlaylists'])
    const ids=[...new Set(Array.isArray(selection)?selection:[])]
    if(!ids.length)return this.api.app.showMessage('请选择歌单')
    const verb=kind==='delete'?'删除':'归档'
    const answer=await this.api.app.showMessage(verb+'所选 '+ids.length+' 个歌单？',{
      type:'warning',modal:true,buttons:[{text:'取消'},{text:verb}]
    })
    if(answer!==1)return
    const result=await this.engine.serial(()=>this.engine.applyOperation({id:this.newId(),kind,ids}))
    if(!result.ok)throw new Error(result.error)
    await this.api.configuration.setConfigs({selectedPlaylists:[]})
    await this.refreshNative()
    await this.api.app.showMessage('已'+verb+' '+result.count+' 个歌单')
  }
  async start(){
    await this.portable.load()
    // v0.2.x paired to a helper executable. It is never consulted in portable mode.
    if(await this.api.storage.fileExists('connection.json')) {
      try{await this.api.storage.removeFile('connection.json')}catch{}
    }
    await this.engine.load()
    if(this.engine!==this.catalogEngine)await this.catalogEngine.load()
    registerCatalogResources(this.api,this)
    const commands={
      loginNetease:()=>this.neteaseLogin(),
      loginQQ:()=>this.login('qqmusic'),
      loginKugou:()=>this.login('kugou'),
      importNetease:()=>this.importCookie('netease'),
      importQQ:()=>this.importCookie('qqmusic'),
      openQQWeb:()=>this.webLogin('qqmusic'),importAccountState:()=>this.importAccountState(),
      importKugou:()=>this.importCookie('kugou'),
      configureWebdav:()=>this.configureWebdav(),clearWebdav:()=>this.clearWebdav(),
      sync:()=>this.sync(),refreshLists:()=>this.tick()
    }
    for(const [name,action] of Object.entries(commands)){
      await this.api.command.registerCommand(name,async()=>{
        if(this.interactive)return
        this.interactive=true
        try{await action()}
        catch(e){await this.api.app.showMessage(cleanMessage(e),{type:'error'})}
        finally{this.interactive=false}
      })
    }
    this.api.musicList?.onListAction(event=>{
      void this.engine.onExternalAction(event).catch(()=>{})
      void this.refreshNative().catch(()=>{})
    })
    this.api.configuration.onConfigChanged(keys=>{
      if(keys.includes('webdavPassword')){
        this.passwordUpdate=this.passwordUpdate.then(()=>this.captureWebdavPassword()).catch(()=>{})
      }
      if(keys.some(k=>['enabledAccounts','enabledLX'].includes(k)))void this.refreshNative().catch(()=>{})
    })
    const configValues={
      webdavUrl:this.portable.webdav?.url??'',
      webdavUsername:this.portable.webdav?.username??'',
      webdavFolder:this.portable.webdav?.folder??'/LX_Music'
    }
    const [unsavedPassword]=await this.configs(['webdavPassword'])
    if(unsavedPassword && unsavedPassword!==DAV_MASK){
      // Previous crash during editing might leave a secret in settings.
      this.portable.pendingDAVPassword=unsavedPassword
    }
    await this.api.configuration.setConfigs({
      ...configValues,
      webdavPassword:this.portable.webdav?.password||this.portable.pendingDAVPassword?DAV_MASK:''
    })
    await this.refreshNative()
    // Loading the extension never opens a login window, sends SMS or requires a local service.
    await this.tick()
    this.timer=setInterval(()=>{void this.tick()},45000)
  }
}
