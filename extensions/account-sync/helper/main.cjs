const {app,BrowserWindow,ipcMain,safeStorage,session,shell} = require('electron')
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto')
const {pathToFileURL}=require('node:url')
const providers=require('./providers.cjs')
let main,relay,stored={accounts:{},webdav:null},vault,server,busy=false
const PORT=38481
const uiURL=pathToFileURL(path.join(__dirname,'ui/index.html')).href
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
   if(req.url==='/v1/pair'){const result=relay.pair(payload.code);await save();send(res,200,result);return}
   const clientId=relay.authenticate(req.headers.authorization);if(!clientId){send(res,401,{error:'Unauthorized'});return}
   if(req.url==='/v1/poll'){if(payload.clientId!==clientId){send(res,403,{error:'Wrong client'});return}const result=relay.poll(clientId,payload);send(res,200,result);void save();return}
   if(req.url==='/v1/open'){main?.show();main?.focus();send(res,200,{ok:true});return}
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
  await providers.validateQQMusicCredential(credentials);stored.accounts.qqmusic=credentials;await save();finish(true);void syncSource('qqmusic')
 }catch{}finally{checking=false}}
 function changed(_event,c){if(['qqmusic_key','qm_keyst','qqmusic_uin','musicid'].includes(c.name))void check()}
 const timer=setInterval(()=>void check(),6000);ses.cookies.on('changed',changed);win.on('closed',()=>finish(false));win.webContents.on('did-finish-load',()=>void check());void win.loadURL('https://y.qq.com/n/ryqq/profile').catch(()=>finish(false,'无法打开腾讯登录页面'))
 }).finally(()=>{loginPending=null});return loginPending}
async function ui(action,data={}){
 if(action==='state')return { ...relay.view(),accounts:Object.fromEntries(['netease','qqmusic','kugou'].map(x=>[x,{connected:!!stored.accounts[x],...statuses[x]}])),webdav:{configured:!!stored.webdav,...statuses.lx},busy,pairCode:relay.pairExpiry>Date.now()?relay.pairCode:'',pairExpiry:relay.pairExpiry }
 if(action==='pairing')return relay.pairing()
 if(action==='qqLogin')return qqLogin()
 if(action==='sms'){
  if(data.platform==='netease')await providers.sendNeteasePhoneCode(data.phone)
  else if(data.platform==='kugou')await providers.sendKugouPhoneCode(data.phone)
  else throw new Error('不支持的登录方式');return true
 }
 if(action==='login'){
  if(data.platform==='netease')stored.accounts.netease=await providers.loginNeteaseWithPhoneCode(data.phone,data.code)
  else if(data.platform==='kugou')stored.accounts.kugou=await providers.loginKugouWithPhoneCode(data.phone,data.code)
  else throw new Error('不支持的登录方式');await save();void syncSource(data.platform);return true
 }
 if(action==='webdav'){
  if(typeof data.url!=='string'||typeof data.username!=='string'||typeof data.password!=='string')throw new Error('请填写 WebDAV 信息')
  stored.webdav={url:data.url.trim(),username:data.username,password:data.password,folder:data.folder||'/LX_Music'};await save();void syncWebdav();return true
 }
 if(action==='refresh'){void refresh(true);return true}
 if(action==='operation'){const id=relay.addOperation(data.clientId,data.kind,data);await save();return id}
 if(action==='importLegacy'){const n=void refresh(true);return n}
 if(action==='diagnostics')return Object.fromEntries(Object.entries(statuses).map(([k,v])=>[k,v]))
 throw new Error('Unknown action')
}
const uiSmoke=process.argv.includes('--ui-smoke')
app.setName('anylisten-account-helper')
if(uiSmoke)app.setPath('userData',path.join(app.getPath('temp'),'anylisten-helper-smoke-'+crypto.randomUUID()))
if(!app.requestSingleInstanceLock()){app.quit()}else{
 app.on('second-instance',()=>{if(main){main.show();main.focus()}})
 app.whenReady().then(async()=>{
  const {Relay}=await import('./relay.mjs');const dir=app.getPath('userData');await fs.mkdir(dir,{recursive:true});vault=path.join(dir,'account-vault.bin')
  try{const saved=JSON.parse(safeStorage.decryptString(await fs.readFile(vault)));stored={...stored,...saved}}catch(e){if(e.code!=='ENOENT'&&await fs.stat(vault).catch(()=>null))throw new Error('无法解密本机账号数据，请检查系统钥匙串')}
  relay=new Relay(stored.relay);if(process.argv.includes('--diagnose')){const result={accounts:Object.keys(stored.accounts)};if(stored.accounts.kugou){try{const index=await providers.readKugouPlaylistIndex(stored.accounts.kugou);result.kugouIndex={count:index.length,types:index.map(x=>x.type),zeroIds:index.filter(x=>x.id==='0').length}}catch(e){result.indexError=errorText(e)}try{const daily=await providers.readKugouDaily(stored.accounts.kugou);result.kugouDaily=daily?.list?.length??0}catch(e){result.dailyError=errorText(e)}}result.shapes=providers.getKugouDiagnostics?.();console.log(JSON.stringify(result));app.quit();return}if(!uiSmoke)await startServer();relay.pairing()
  ipcMain.handle('account-sync-ui',async(event,action,data)=>{if(event.senderFrame?.url!==uiURL)throw new Error('Forbidden');try{return {ok:true,value:await ui(action,data)}}catch(e){return {ok:false,error:errorText(e)}}})
  if(uiSmoke)relay.clients.smoke={label:'测试播放器',lists:Array.from({length:6},(_,i)=>({id:'test-'+i,name:'LX N·测试歌单 '+(i+1),songCount:i+3})),archives:[],lastSeen:Date.now()}
  main=new BrowserWindow({title:'AnyListen 账号助手',width:980,height:760,minWidth:700,minHeight:500,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}})
  main.webContents.setWindowOpenHandler(()=>({action:'deny'}));main.webContents.on('will-navigate',(e)=>e.preventDefault());await main.loadFile(path.join(__dirname,'ui/index.html'))
  if(uiSmoke){
    const result=await main.webContents.executeJavaScript(`(async()=>{await new Promise(r=>setTimeout(r,200));document.querySelector('[data-tab="lists"]').click();await new Promise(r=>setTimeout(r,100));const rows=[...document.querySelectorAll('.playlist-row')];if(rows.length!==6)throw Error('Rows not rendered');rows[0].dispatchEvent(new MouseEvent('click',{bubbles:true}));rows[2].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));const ctrl=document.querySelector('#count').textContent;rows[5].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));return {rowCount:rows.length,ctrl,shift:document.querySelector('#count').textContent,deleteEnabled:!document.querySelector('#delete').disabled}})()`)
    const image=await main.webContents.capturePage();await fs.writeFile(path.join(__dirname,'ui-smoke.png'),image.toPNG());console.log(JSON.stringify(result));app.quit();return
  }
  void refresh(true);setInterval(()=>void refresh(),60000)
 }).catch(e=>{console.error(errorText(e));app.quit()})
 app.on('window-all-closed',()=>{server?.close();app.quit()})
}
