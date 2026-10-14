import { SyncEngine, selectableLists } from './engine.mjs'
import { CatalogEngine, registerCatalogResources } from './catalog-engine.mjs'
const ENDPOINT = 'http://127.0.0.1:38481'
const LABELS = { netease:'网易云', qqmusic:'QQ音乐', kugou:'酷狗' }
const CLEAN_ERROR = /(?:MUSIC_U|token|musickey|password|Authorization)[=:][^\s;,]+/ig
export class NativeController {
  constructor(api) {
    this.api=api; this.connection=null; this.backendState={}; this.busy=false
    this.seq=0; this.lastUi=''; this.enabled=['netease','qqmusic','kugou','lx']; this.interactive=false
    this.catalogEngine=new CatalogEngine(api,payload=>this.transport(payload))
    this.engine=api.musicList?new SyncEngine(api,payload=>this.transport(payload)):this.catalogEngine
  }
  async configs(keys) { return this.api.configuration.getConfigs(keys) }
  async request(route,body={},timeout=20000,authenticated=true) {
    if(authenticated&&!this.connection)throw new Error('请先连接本机登录组件')
    const response=await this.api.request(ENDPOINT+route,{method:'POST',json:body,headers:authenticated?{Authorization:'Bearer '+this.connection.token}:{},timeout,maxRedirect:0})
    if(response.statusCode!==200)throw new Error(response.body?.error||'本机登录组件未连接')
    return response.body
  }
  async connect() {
    if(this.connection)return
    // Only an explicit account command can ask the local component for permission.
    const result=await this.request('/v1/native/pair',{name:'AnyListen 账号歌单同步',extensionKey:this.api.env?.publicKey||''},90000,false)
    if(!/^[a-f0-9]{64}$/.test(result?.token)||!result.clientId)throw new Error('连接未完成')
    this.connection={token:result.token,clientId:result.clientId}
    await this.api.storage.writeFile('connection.json',JSON.stringify(this.connection))
  }
  async transport(payload) {
    if(!this.connection)return {catalog:[],operations:[]}
    const response=await this.request('/v1/poll',{clientId:this.connection.clientId,...payload})
    // The native extension owns selection/deletion. It does not accept remote UI operations.
    return {operations:[],catalog:(response.catalog||[]).filter(x=>this.enabled.includes(x.source))}
  }
  async refreshNative() {
    const [filter,accounts,lx]=await this.configs(['playlistFilter','enabledAccounts','enabledLX'])
    this.enabled=[...(Array.isArray(accounts)?accounts:['netease','qqmusic','kugou']),...(Array.isArray(lx)?lx:['lx'])]
    const all=this.api.musicList?selectableLists(await this.api.musicList.getAllUserLists()):await this.catalogEngine.refreshIndex()
    const needle=String(filter||'').trim().toLocaleLowerCase()
    this.visible=all.filter(x=>!needle||x.name.toLocaleLowerCase().includes(needle))
    const settings={
      playlistItems:this.visible.map(x=>({id:x.id,name:x.name})),
      archiveItems:this.engine.state.archives.filter(x=>!x.restoredAt).map(x=>({id:x.id,name:(x.kind==='delete'?'回收站':'归档')+' · '+(x.names?.slice(0,2).join('、')||'歌单')+(x.count>2?' 等 '+x.count+' 个':'' )})),
      accountItems:Object.entries(LABELS).map(([id,label])=>{
        const s=this.backendState.accounts?.[id]||{}
        const count=all.filter(x=>String(x.meta?.externalMirror||'').startsWith(id==='qqmusic'?'qqmusic:':id+':')).length
        const status=s.stage==='syncing'?'同步中':s.stage==='error'?'同步失败':count?count+' 个歌单':s.connected?'已登录':'未登录'
        return {id,name:label+' · '+status}
      }),
      webdavItems:[{id:'lx',name:this.backendState.webdav?.configured?'已连接':'未设置'}]
    }
    const signature=JSON.stringify(settings)
    if(signature!==this.lastUi){this.lastUi=signature;await this.api.configuration.setConfigs(settings)}
  }
  async refreshState() {
    if(!this.connection)return
    this.backendState=await this.request('/v1/native/state',{})
  }
  async tick() {
    if(this.busy)return
    this.busy=true
    try{await this.refreshNative();if(this.connection){await this.engine.cycle();if(this.engine!==this.catalogEngine)await this.catalogEngine.cycle();await this.refreshState();await this.refreshNative()}}
    catch { /* Credentials and response bodies are never logged. Native refresh reports explicit failures. */ }
    finally{this.busy=false}
  }
  newId() {return 'native_'+Date.now().toString(36)+'_'+(++this.seq)}
  async login(platform) {
    await this.connect()
    const start=await this.request('/v1/native/action',{action:'login',platform})
    if(!start.jobId)throw new Error('登录未启动')
    let completed=false
    for(let i=0;i<240;i++){
      await new Promise(r=>setTimeout(r,1500))
      const status=await this.request('/v1/native/job',{jobId:start.jobId})
      if(status.status==='pending')continue
      if(status.status==='failed')throw new Error(status.error||'登录失败')
      if(status.result!==true)return
      completed=true;break
    }
    if(!completed)throw new Error('登录超时，请重试')
    await this.api.app.showMessage('登录成功')
    await this.tick()
  }
  async loginKugou() {
    await this.connect()
    const phone=await this.api.app.showInputDialog({title:'酷狗账号登录',placeholder:'手机号',validateInput:async value=>/^1\d{10}$/.test(value)?null:'手机号格式不正确'})
    if(!phone)return
    await this.request('/v1/native/action',{action:'sms',platform:'kugou',phone})
    const code=await this.api.app.showInputDialog({title:'酷狗账号登录',placeholder:'验证码',password:true,validateInput:async value=>/^\d{4,8}$/.test(value)?null:'验证码格式不正确'})
    if(!code)return
    await this.request('/v1/native/action',{action:'smsLogin',platform:'kugou',phone,code},35000)
    await this.api.app.showMessage('登录成功');await this.tick()
  }
  async configureWebdav() {
    await this.connect()
    const url=await this.api.app.showInputDialog({title:'WebDAV 设置',placeholder:'服务器地址',validateInput:async v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?null:'请输入 HTTPS 地址'}catch{return '请输入服务器地址'}}})
    if(!url)return
    const username=await this.api.app.showInputDialog({title:'WebDAV 设置',placeholder:'用户名'});if(!username)return
    const password=await this.api.app.showInputDialog({title:'WebDAV 设置',placeholder:'应用密码',password:true});if(!password)return
    const folder=await this.api.app.showInputDialog({title:'WebDAV 设置',placeholder:'歌单目录',value:'/LX_Music'});if(!folder)return
    await this.request('/v1/native/action',{action:'webdav',url,username,password,folder})
    await this.tick();await this.api.app.showMessage('设置成功')
  }
  async manage(kind) {
    const [selected]=await this.configs(['selectedPlaylists'])
    const ids=[...new Set(Array.isArray(selected)?selected:[])]
    if(!ids.length)return this.api.app.showMessage('请先选择歌单')
    const verb=kind==='delete'?'删除':'归档'
    const answer=await this.api.app.showMessage(verb+'所选 '+ids.length+' 个歌单？',{type:'warning',modal:true,buttons:[{text:'取消'},{text:verb}]})
    if(answer!==1)return
    const result=await this.engine.serial(()=>this.engine.applyOperation({id:this.newId(),kind,ids}))
    if(!result.ok)throw new Error(result.error)
    await this.api.configuration.setConfigs({selectedPlaylists:[]})
    await this.refreshNative()
    await this.api.app.showMessage('已'+verb+' '+result.count+' 个歌单')
  }
  async restore() {
    const [ids]=await this.configs(['selectedArchives'])
    if(!Array.isArray(ids)||!ids.length)return this.api.app.showMessage('请先选择归档')
    let count=0
    for(const id of ids){const r=await this.engine.serial(()=>this.engine.applyOperation({id:this.newId(),kind:'restore',archiveId:id}));if(!r.ok)throw new Error(r.error);count+=r.count||0}
    await this.api.configuration.setConfigs({selectedArchives:[]})
    await this.refreshNative();await this.api.app.showMessage('已恢复 '+count+' 个歌单')
  }
  async sync() {
    await this.connect();await this.refreshNative()
    const job=await this.request('/v1/native/action',{action:'refresh',sources:this.enabled})
    if(job.jobId){for(let i=0;i<120;i++){
      await new Promise(r=>setTimeout(r,1000))
      await this.tick()
      const result=await this.request('/v1/native/job',{jobId:job.jobId})
      if(result.status==='failed')throw new Error(result.error||'同步失败')
      if(result.status==='done')break
    }}
    await this.tick()
    if(!Object.values(this.backendState.accounts||{}).some(x=>x.connected)&&!this.backendState.webdav?.configured)throw new Error('请先登录账号或设置 WebDAV')
    const error=Object.values(this.backendState.accounts||{}).find(x=>x.stage==='error')
    if(error)throw new Error(error.error||'部分账号同步失败')
    if(this.backendState.webdav?.stage==='error')throw new Error(this.backendState.webdav.error||'WebDAV 同步失败')
    await this.api.app.showMessage('同步完成')
  }
  async start() {
    if(await this.api.storage.fileExists('connection.json')){try{this.connection=JSON.parse(await this.api.storage.readFile('connection.json','utf-8'))}catch{this.connection=null}}
    await this.engine.load()
    if(this.engine!==this.catalogEngine)await this.catalogEngine.load()
    registerCatalogResources(this.api,this)
    const actions={
      loginNetease:()=>this.login('netease'),loginQQ:()=>this.login('qqmusic'),loginKugou:()=>this.loginKugou(),configureWebdav:()=>this.configureWebdav(),sync:()=>this.sync(),
      selectAll:async()=>{await this.refreshNative();await this.api.configuration.setConfigs({selectedPlaylists:this.visible.map(x=>x.id)})},
      clearSelection:()=>this.api.configuration.setConfigs({selectedPlaylists:[]}),archiveSelected:()=>this.manage('archive'),deleteSelected:()=>this.manage('delete'),
      refreshLists:()=>this.refreshNative(),restoreSelected:()=>this.restore()
    }
    const stockCommands=['loginNetease','loginQQ','loginKugou','configureWebdav','sync','refreshLists']
    for(const [name,action] of Object.entries(actions).filter(([name])=>stockCommands.includes(name)))await this.api.command.registerCommand(name,async()=>{
      if(this.interactive)return
      this.interactive=true
      try{return await action()}catch(error){await this.api.app.showMessage(String(error.message||'操作失败').replace(CLEAN_ERROR,'[hidden]').slice(0,160),{type:'error'})}
      finally{this.interactive=false}
    })
    this.api.musicList?.onListAction(event=>{void this.engine.onExternalAction(event).catch(()=>{});if(this.uiTimer)clearTimeout(this.uiTimer);this.uiTimer=setTimeout(()=>{void this.refreshNative().catch(()=>{})},200)})
    this.api.configuration.onConfigChanged(keys=>{if(keys.some(x=>['playlistFilter','enabledAccounts','enabledLX'].includes(x)))void this.refreshNative().catch(()=>{})})
    await this.refreshNative();await this.tick()
    this.timer=setInterval(()=>{void this.tick()},4000)
  }
}
