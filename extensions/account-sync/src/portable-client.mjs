import {NetEaseAccount} from './portable-netease.mjs'
import {QQAccount} from './portable-qq.mjs'
import {KugouAccount} from './portable-kugou.mjs'
import {readLX, validateDAV} from './portable-lx.mjs'
import {cleanMessage,cookiePairs} from './portable-utils.mjs'

const FILE='portable-accounts.json'
const DAVFILE='portable-webdav.json'
const sourceNames={netease:'网易云',qqmusic:'QQ音乐',kugou:'酷狗',lx:'LX N'}
const INTERVALS={netease:3*3600000,qqmusic:3*3600000,kugou:3*3600000,lx:180000}
const RETRY=30*60000

export class PortableClient {
  constructor(api) {
    this.api=api
    this.credentials={},this.webdav=null
    this.providers={
      netease:new NetEaseAccount(api),qqmusic:new QQAccount(api),kugou:new KugouAccount(api)
    }
    this.status={}
    this.lastAttempt={}
    this.lastSuccess={}
    this.pendingSync=null
    this.pendingDAVPassword=null
  }
  async load() {
    for(const [file,field] of [[FILE,'credentials'],[DAVFILE,'webdav']]){
      if(!await this.api.storage.fileExists(file))continue
      try{
        const raw=JSON.parse(await this.api.storage.readFile(file,'utf-8'))
        if(field==='credentials' && raw && typeof raw==='object'){
          const safe={}
          for(const k of ['netease','qqmusic','kugou'])if(raw[k])safe[k]=raw[k]
          this.credentials=safe
        }else if(field==='webdav'&&raw?.url)this.webdav=raw
      }catch{/* Malformed state must not trigger automatic account actions. */}
    }
  }
  async save(){await this.api.storage.writeFile(FILE,JSON.stringify(this.credentials))}
  async configureDAV(cfg) {
    validateDAV(cfg)
    const normalized={url:cfg.url.trim(),username:cfg.username.trim(),password:cfg.password,
      folder:String(cfg.folder||'/LX_Music').trim()}
    // Password lives in extension private storage, not the visible settings fields.
    await this.api.storage.writeFile(DAVFILE,JSON.stringify(normalized))
    this.webdav=normalized
    this.lastAttempt.lx=0
    return true
  }
  async clearDAV() {
    this.webdav=null
    this.lastAttempt.lx=0
    delete this.status.lx
    if(await this.api.storage.fileExists(DAVFILE))
      await this.api.storage.removeFile(DAVFILE)
  }
  async importCookie(platform,cookieText) {
    const cookie=String(cookieText??'').trim()
    if(cookie.length>15000)throw new Error('登录状态内容过长')
    const values=cookiePairs(cookie)
    if(platform==='netease'){
      if(!values.get('MUSIC_U'))throw new Error('没有找到网易云 MUSIC_U，请从已登录的官方网站获取完整 Cookie')
      await this.providers.netease.uid(cookie)
      this.credentials.netease=cookie
    }else if(platform==='qqmusic'){
      const musicId=String(values.get('qqmusic_uin')??values.get('musicid')??values.get('uin')??'').replace(/^o/,'')
      const musicKey=values.get('qqmusic_key')??values.get('qm_keyst')??''
      if(!/^\d{4,20}$/.test(musicId)||!musicKey)throw new Error('QQ Cookie 缺少 musicid/qqmusic_key，无法导入')
      const credential={musicId,musicKey,cookie}
      await this.providers.qqmusic.validate(credential)
      this.credentials.qqmusic=credential
    }else if(platform==='kugou'){
      const userId=values.get('userid')??'',token=values.get('token')??''
      const mid=values.get('KUGOU_API_MID')??values.get('mid')??''
      if(!/^\d{1,20}$/.test(userId)||!token||!/^[0-9a-f]{32}$/i.test(mid))
        throw new Error('酷狗登录状态必须包含 userid、token、mid')
      this.credentials.kugou={userId,token,mid}
    }else throw new Error('不支持的音乐平台')
    await this.save()
    this.status[platform]={connected:true,stage:'ready'}
    this.lastAttempt[platform]=0
    return true
  }
  async login(platform,onStatus){
    const provider=this.providers[platform]
    if(!provider)throw new Error('未找到音乐平台')
    if(platform==='qqmusic'){
      const credential=await provider.loginWX(onStatus)
      if(!credential)return false
      await provider.validate(credential)
      this.credentials.qqmusic=credential
    }else if(platform==='netease'){
      const credential=await provider.loginQR(onStatus)
      if(!credential)return false
      this.credentials.netease=credential.cookie
    }else {
      const title=sourceNames[platform]+'账号登录'
      const phone=await this.api.app.showInputDialog({title,placeholder:'手机号',
        validateInput:async v=>/^1\d{10}$/.test(v)?null:'手机号格式不正确'})
      if(!phone)return false
      await provider.sendSms(phone)
      const code=await this.api.app.showInputDialog({title,placeholder:'短信验证码',password:true,
        validateInput:async v=>/^\d{4,8}$/.test(v)?null:'验证码格式不正确'})
      if(!code)return false
      let credential
      try{
        credential=await provider.loginSms(phone,code)
      }catch(error){
        if(platform!=='kugou'||Number(error?.platformCode)!==20006)throw error
        const answer=await this.api.app.showMessage(
          '酷狗验证码提交未通过校验（20006），是否改用酷狗音乐 App 扫码登录？',{
            modal:true,buttons:[{text:'取消'},{text:'酷狗扫码登录'}]
          })
        if(answer!==1)throw error
        credential=await provider.loginQR(onStatus)
        if(!credential)return false
      }
      this.credentials[platform]=platform==='netease'?credential.cookie:credential
    }
    await this.save()
    this.status[platform]={connected:true,stage:'ready'}
    this.lastAttempt[platform]=0
    return true
  }
  isConnected(source) {
    return source==='lx'?!!this.webdav:!!this.credentials[source]
  }
  getState(){
    const accounts=Object.fromEntries(['netease','qqmusic','kugou'].map(k=>[
      k,{connected:!!this.credentials[k],...this.status[k]}
    ]))
    return {accounts,webdav:{configured:!!this.webdav,...this.status.lx}}
  }
  async refresh(sources=['netease','qqmusic','kugou','lx'], force=false){
    if(this.pendingSync)return this.pendingSync
    this.pendingSync=this._refresh(sources,force).finally(()=>{this.pendingSync=null})
    return this.pendingSync
  }
  async _refresh(sources,force) {
    const updates=[]
    let attempted=0,successful=0
    for(const source of sources){
      if(!['netease','qqmusic','kugou','lx'].includes(source)||!this.isConnected(source))continue
      const now=Date.now()
      if(!force && now-(this.lastAttempt[source]??0)<(this.status[source]?.stage==='error'?RETRY:INTERVALS[source]))continue
      this.lastAttempt[source]=now
      attempted++
      this.status[source]={connected:true,stage:'syncing'}
      try{
        let result
        if(source==='lx')result=await readLX(this.api,this.webdav)
        else {
          const credential=this.credentials[source]
          result=await this.providers[source].read(credential)
        }
        if(!Array.isArray(result?.lists)||!result.namespace)throw new Error('平台未返回完整歌单')
        const catalog=result.lists.map(item=>({
          marker:result.namespace+':'+item.key,source,name:item.name,
          songs:item.list,revision:Date.now()
        }))
        updates.push(...catalog)
        this.status[source]={connected:true,stage:'ready',count:catalog.length}
        this.lastSuccess[source]=Date.now()
        successful++
      }catch(e){
        this.status[source]={connected:true,stage:'error',error:cleanMessage(e)}
      }
    }
    return {catalog:updates,operations:[],attempted,successful}
  }
}
