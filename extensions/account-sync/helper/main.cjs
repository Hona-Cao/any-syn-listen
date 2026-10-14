const {app,BrowserWindow,dialog,safeStorage,session} = require('electron')
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto')
const providers=require('./providers.cjs')
let relay,stored={accounts:{},webdav:null},vault,server,busy=false
const PORT=38481
const clone=x=>JSON.parse(JSON.stringify(x))
const secure=()=>safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text')
const queues=[]
function errorText(error){return String(error?.message??'请求失败').replace(/MUSIC_U=[^;\s]+|token=[^&\s]+|musickey=[^;\s]+/ig,'[hidden]').slice(0,220)}
let saveTail=Promise.resolve()
function save(){saveTail=saveTail.catch(()=>{}).then(async()=>{if(!secure())throw new Error('请解锁系统钥匙串');const data=JSON.stringify({...stored,relay:relay.saved()});const tmp=vault+'.tmp';await fs.writeFile(tmp,safeStorage.encryptString(data),{mode:0o600});await fs.rename(tmp,vault)});return saveTail}
const statuses={}
function status(source,stage,extra={}){statuses[source]={...statuses[source],stage,...extra}}
async function syncSource(platform){
 const credential=stored.accounts[platform];if(!credential)return
 status(platform,'syncing')
 try{
  let lists,namespace
  if(platform==='netease'){const result=await providers.readNeteaseAccountPlaylists(credential);lists=result.lists;namespace='netease:'+result.uid}
  else if(platform==='qqmusic'){lists=await providers.readQQMusicPlaylists(credential);namespace='qqmusic:'+credential.musicId}
  else {lists=await providers.readKugouPlaylists(credential);namespace='kugou:'+credential.userId}
  if(!Array.isArray(lists))throw new Error('平台未返回歌单')
  const entries=lists.map(x=>({marker:namespace+':'+x.key,name:x.name,songs:x.list}))
  relay.publish(platform,entries)
  status(platform,'ready',{count:lists.length,tracks:lists.reduce((n,x)=>n+x.list.length,0),lastSuccess:Date.now(),error:lists.length?'':'没有获取到歌单或推荐'})
 }catch(e){status(platform,'error',{error:errorText(e)})}
}
async function syncWebdav(){
 const cfg=stored.webdav;if(!cfg)return
 status('lx','syncing')
 try{
  const folder='/'+String(cfg.folder||'/LX_Music').replace(/^\/+|\/+$/g,'')
  const base=new URL(cfg.url);if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw new Error('WebDAV 请使用 HTTPS')
  if(base.username||base.password)throw new Error('地址中不能包含密码')
  const url=cfg.url.replace(/\/+$/,'')+folder+'/playlists.json'
  const response=await fetch(url,{headers:{Authorization:'Basic '+Buffer.from(cfg.username+':'+cfg.password).toString('base64')},redirect:'error',signal:AbortSignal.timeout(20000)})
  if(!response.ok)throw new Error('WebDAV '+response.status)
  const text=await response.text();if(text.length>30*1024*1024)throw new Error('WebDAV 歌单文件过大')
  const lists=providers.parseLXWebDAVPlaylists(text)
  const id=crypto.createHash('sha256').update(cfg.url+'|'+cfg.username+'|'+folder).digest('hex').slice(0,16)
  relay.publish('lx',lists.map(x=>({marker:'lx:'+id+':'+x.key,aliases:['lx-webdav:'+folder+':'+x.key],name:x.name.replace(/^LX N\s*·\s*/,'LX N·'),songs:x.list})))
  status('lx','ready',{count:lists.length,lastSuccess:Date.now(),error:''})
 }catch(e){status('lx','error',{error:errorText(e)})}
}
async function refresh(force=false){
 if(busy)return;busy=true
 try{await Promise.all([...['netease','qqmusic','kugou'].filter(x=>force||Date.now()-(statuses[x]?.lastAttempt||0)>3*3600000).map(async x=>{status(x,statuses[x]?.stage||'idle',{lastAttempt:Date.now()});await syncSource(x)}), (force||Date.now()-(statuses.lx?.lastAttempt||0)>180000)?(async()=>{status('lx',statuses.lx?.stage||'idle',{lastAttempt:Date.now()});await syncWebdav()})():null])}
 finally{busy=false}
}
function send(res,code,obj){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))}
function startServer(){return new Promise((resolve,reject)=>{
 server=http.createServer(async(req,res)=>{
  if(req.headers.host!=='127.0.0.1:'+PORT||req.headers.origin){send(res,403,{error:'Forbidden'});return}
  if(req.method!=='POST'){send(res,405,{error:'Method not allowed'});return}
  let raw='',size=0;try{for await(const part of req){size+=part.length;if(size>2*1024*1024){send(res,413,{error:'Too large'});req.destroy();return}raw+=part}const payload=JSON.parse(raw||'{}')
   if(req.url==='/v1/native/pair'){await nativePair(res);return}
   const clientId=relay.authenticate(req.headers.authorization);if(!clientId){send(res,401,{error:'Unauthorized'});return}
   if(req.url==='/v1/poll'){if(payload.clientId!==clientId){send(res,403,{error:'Wrong client'});return}const result=relay.poll(clientId,payload);send(res,200,result);void save();return}
   if(req.url.startsWith('/v1/native/')){await nativeRoute(req,res,payload,clientId);return}
   if(req.url==='/v1/refresh'){send(res,200,{ok:true});void refresh(true);return}
   send(res,404,{error:'Not found'})
  }catch{send(res,400,{error:'Request rejected'})}
 });server.requestTimeout=25000;server.headersTimeout=10000;server.on('error',reject);server.listen(PORT,'127.0.0.1',resolve)
})}
const qqAllowed=(url)=>{try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='qq.com'||u.hostname.endsWith('.qq.com'))}catch{return false}}
let loginPending=null
function qqLogin(){if(loginPending)return loginPending;loginPending=new Promise((resolve,reject)=>{
 const ses=session.fromPartition('persist:qq-account-login');const win=new BrowserWindow({title:'QQ音乐账号登录',width:950,height:720,webPreferences:{session:ses,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}})
 let finished=false,checking=false,lastTry=0;const children=[]
 const finish=(ok,err)=>{if(finished)return;finished=true;clearInterval(timer);ses.cookies.removeListener('changed',changed);for(const w of children)if(!w.isDestroyed())w.close();if(!win.isDestroyed())win.close();err?reject(new Error(err)):resolve(ok)}
 const protect=wc=>{wc.on('will-navigate',(event,url)=>{if(!qqAllowed(url))event.preventDefault()});wc.on('will-redirect',(event,url)=>{if(!qqAllowed(url))event.preventDefault()});wc.setWindowOpenHandler(({url})=>qqAllowed(url)?{action:'allow',overrideBrowserWindowOptions:{webPreferences:{session:ses,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}}}:{action:'deny'});wc.on('did-create-window',child=>{children.push(child);protect(child.webContents)})}
 protect(win.webContents)
 async function check(){if(finished||checking||Date.now()-lastTry<3500)return;checking=true;lastTry=Date.now();try{
  const cookies=await ses.cookies.get({url:'https://y.qq.com/'});const m=new Map(cookies.map(x=>[x.name,x.value]));const musicId=(m.get('qqmusic_uin')||m.get('musicid')||m.get('wxuin')||m.get('uin')||'').replace(/^o/,'');const musicKey=m.get('qqmusic_key')||m.get('qm_keyst');if(!musicId||!musicKey)return
  const credentials={musicId,musicKey,cookie:cookies.map(x=>x.name+'='+x.value).join('; ')}
  await providers.validateQQMusicCredential(credentials);if(finished)return;stored.accounts.qqmusic=credentials;await save();finish(true);void syncSource('qqmusic')
 }catch{}finally{checking=false}}
 function changed(_event,c){if(['qqmusic_key','qm_keyst','qqmusic_uin','musicid'].includes(c.name))void check()}
 const timer=setInterval(()=>void check(),6000);ses.cookies.on('changed',changed);win.on('closed',()=>finish(false));win.webContents.on('did-finish-load',()=>void check());void win.loadURL('https://y.qq.com/n/ryqq/profile').catch(()=>finish(false,'无法打开腾讯登录页面'))
 }).finally(()=>{loginPending=null});return loginPending}

const jobs=new Map()
let pairing=false,lastPair=0
async function nativePair(res){
 if(pairing||Date.now()-lastPair<10000){send(res,429,{error:'请稍后重试'});return}
 pairing=true;lastPair=Date.now()
 try{
  const approval=await dialog.showMessageBox({type:'question',title:'AnyListen 账号同步',message:'允许账号歌单同步扩展连接本机登录组件？',buttons:['取消','允许'],defaultId:0,cancelId:0,noLink:true})
  if(approval.response!==1){send(res,403,{error:'连接已取消'});return}
  const pairingCode=relay.pairing().code
  const result=relay.pair(pairingCode)
  await save();send(res,200,result)
 }catch{send(res,500,{error:'连接失败'})}finally{pairing=false}
}
function beginJob(clientId,task){
 const id=crypto.randomBytes(16).toString('hex')
 jobs.set(id,{clientId,status:'pending',created:Date.now()})
 Promise.resolve().then(task).then(result=>jobs.set(id,{clientId,status:'done',result,created:Date.now()}),error=>jobs.set(id,{clientId,status:'failed',error:errorText(error),created:Date.now()}))
 for(const [key,job] of jobs)if(Date.now()-job.created>900000&&job.status!=='pending')jobs.delete(key)
 return id
}
function nativeState(){return {
 accounts:Object.fromEntries(['netease','qqmusic','kugou'].map(key=>[key,{connected:!!stored.accounts[key],...statuses[key]}])),
 webdav:{configured:!!stored.webdav,...statuses.lx},busy
}}
async function nativeRoute(req,res,data,clientId){
 if(req.url==='/v1/native/state'){send(res,200,nativeState());return}
 if(req.url==='/v1/native/job'){
  const job=jobs.get(data.jobId)
  if(!job||job.clientId!==clientId){send(res,404,{error:'任务不存在'});return}
  send(res,200,{status:job.status,result:job.result,error:job.error});return
 }
 if(req.url!=='/v1/native/action'){send(res,404,{error:'接口不存在'});return}
 try{
  if(data.action==='login'){
   if(!['netease','qqmusic'].includes(data.platform))throw new Error('不支持的登录方式')
   const jobId=beginJob(clientId,()=>data.platform==='netease'?neteaseLogin():qqLogin())
   send(res,200,{jobId});return
  }
  if(data.action==='sms'){
   if(data.platform!=='kugou')throw new Error('不支持的登录方式')
   await providers.sendKugouPhoneCode(String(data.phone||''));send(res,200,{ok:true});return
  }
  if(data.action==='smsLogin'){
   if(data.platform!=='kugou')throw new Error('不支持的登录方式')
   stored.accounts.kugou=await providers.loginKugouWithPhoneCode(String(data.phone||''),String(data.code||''))
   await save();send(res,200,{ok:true});void syncSource('kugou');return
  }
  if(data.action==='webdav'){
   if(typeof data.url!=='string'||typeof data.username!=='string'||typeof data.password!=='string')throw new Error('请填写 WebDAV 信息')
   const parsed=new URL(data.url)
   if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('请输入 HTTPS 服务器地址')
   stored.webdav={url:data.url.trim(),username:data.username,password:data.password,folder:String(data.folder||'/LX_Music')}
   await save();send(res,200,{ok:true});void syncWebdav();return
  }
  if(data.action==='refresh'){
   const allow=new Set(Array.isArray(data.sources)?data.sources:['netease','qqmusic','kugou','lx'])
   const jobId=beginJob(clientId,async()=>{await Promise.all(['netease','qqmusic','kugou'].filter(x=>allow.has(x)).map(syncSource));if(allow.has('lx'))await syncWebdav();return true})
   send(res,200,{jobId});return
  }
  throw new Error('不支持的操作')
 }catch(error){send(res,400,{error:errorText(error)})}
}
const neteaseAllowed=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['music.163.com','passport.163.com','reg.163.com'].includes(u.hostname)}catch{return false}}
let neteasePending=null
function neteaseLogin(){
 if(neteasePending)return neteasePending
 neteasePending=new Promise((resolve,reject)=>{
  const ses=session.fromPartition('persist:netease-account-login')
  const win=new BrowserWindow({title:'网易云账号登录',width:470,height:700,webPreferences:{session:ses,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}})
  win.webContents.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36')
  let finished=false,checking=false,lastAttempt=0
  function finish(ok,error){if(finished)return;finished=true;clearInterval(timer);ses.cookies.removeListener('changed',changed);if(!win.isDestroyed())win.close();error?reject(new Error(error)):resolve(ok)}
  async function check(){
   if(finished||checking||Date.now()-lastAttempt<3500)return
   checking=true;lastAttempt=Date.now()
   try{
    const cookies=await ses.cookies.get({url:'https://music.163.com/'})
    if(!cookies.some(x=>x.name==='MUSIC_U'&&x.value))return
    const cookie=cookies.map(x=>x.name+'='+x.value).join('; ')
    await providers.getNeteaseAccountId(cookie)
    if(finished)return
    stored.accounts.netease=cookie;await save();finish(true);void syncSource('netease')
   }catch{}finally{checking=false}
  }
  function changed(_event,cookie){if(['MUSIC_U','__csrf'].includes(cookie.name))void check()}
  const timer=setInterval(()=>void check(),5000)
  ses.cookies.on('changed',changed)
  win.webContents.on('will-navigate',(event,url)=>{if(!neteaseAllowed(url))event.preventDefault()})
  win.webContents.on('will-redirect',(event,url)=>{if(!neteaseAllowed(url))event.preventDefault()})
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  win.webContents.on('did-finish-load',()=>void check())
  win.on('closed',()=>finish(false))
  void win.loadURL('https://music.163.com/m/login').catch(()=>finish(false,'无法打开网易云登录页'))
 }).finally(()=>{neteasePending=null})
 return neteasePending
}
// Keep the original vault namespace; existing bridge accounts remain encrypted and intact.
app.setName('anylisten-account-helper')
if(!app.requestSingleInstanceLock())app.quit()
else{
 app.whenReady().then(async()=>{
  const {Relay}=await import('./relay.mjs')
  const dir=app.getPath('userData');await fs.mkdir(dir,{recursive:true});vault=path.join(dir,'account-vault.bin')
  if(!secure())throw new Error('请解锁系统钥匙串')
  try{const saved=JSON.parse(safeStorage.decryptString(await fs.readFile(vault)));stored={...stored,...saved}}catch(e){if(e.code!=='ENOENT')throw new Error('无法读取本机登录状态')}
  relay=new Relay(stored.relay)
  await startServer()
  console.log('Account bridge ready on loopback; no management window is created.')
  void refresh(true);setInterval(()=>void refresh(),60000)
 }).catch(error=>{console.error(errorText(error));app.quit()})
 // Only platform login pages open windows. Closing them must not stop background synchronization.
 app.on('window-all-closed',()=>{})
 app.on('before-quit',()=>{server?.close()})
}
