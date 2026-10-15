import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import {NativeController} from '../src/native-controller.mjs'
import {PortableClient} from '../src/portable-client.mjs'
import {NetEaseAccount} from '../src/portable-netease.mjs'
import {QQAccount} from '../src/portable-qq.mjs'
import {KugouAccount} from '../src/portable-kugou.mjs'
import {readLX} from '../src/portable-lx.mjs'

const netSong=(id)=>({
  id,name:'曲目 '+id,ar:[{name:'歌手'}],al:{id:23,name:'专辑'},dt:120000
})
const toBytes=(str,from)=>Uint8Array.from(Buffer.from(str,from==='hex'?'hex':from==='base64'?'base64':'utf8'))
function makeApi(handle){
  const files=new Map(),config=new Map(),commands=new Map(),dialogs=[]
  let smsCount=0
  const toStr=(b,format)=>Buffer.from(b).toString(format==='utf-8'?'utf8':format)
  const api={
    storage:{
      fileExists:async path=>files.has(path),readFile:async path=>files.get(path),
      writeFile:async(path,v)=>{files.set(path,v)},removeFile:async path=>{files.delete(path)}
    },
    configuration:{
      getConfigs:async keys=>keys.map(key=>config.get(key)),
      setConfigs:async values=>{for(const [k,v] of Object.entries(values))config.set(k,v)},
      onConfigChanged:()=>()=>{}
    },
    app:{
      showMessage:async(...args)=>{dialogs.push(args);return 1},
      showInputDialog:async()=>null
    },
    command:{registerCommand:async(k,fn)=>{commands.set(k,fn)}},
    registerResourceAction:()=>{},
    logcat:{warn(){},error(){}},
    utils:{
      dataConverter:async(input,from='utf-8',to='binary')=>
        typeof input==='string'?
          to==='binary'?toBytes(input,from):
            Buffer.from(input,from==='hex'?'hex':from==='base64'?'base64':'utf8')
              .toString(to==='utf-8'?'utf8':to) :
          toStr(input,from),
      crypto:{
        aesEncrypt:async()=> 'testparams',
        rsaEncrypt:async()=>new Uint8Array(128),
        md5:async data=>createHash('md5').update(data).digest('hex'),
        sha256:async data=>createHash('sha256').update(data).digest('hex'),
        randomBytes:async n=>new Uint8Array(n).fill(1)
      }
    },
    async request(url,opts){
      if(url.includes('127.0.0.1:38481'))throw new Error('Legacy bridge was called')
      if(url.includes('captcha/sent')||url.includes('send_mobile_code'))smsCount++
      return handle(url,opts)
    }
  }
  return {api,files,config,commands,dialogs,smsCount:()=>smsCount}
}
const reply=(body,headers={})=>({statusCode:200,body,headers,raw:new Uint8Array()})

test('standalone bundle contains no localhost account helper',async()=>{
  const source=await fs.readFile('src/native-controller.mjs','utf8')
  const bundle=await fs.readFile('dist/main.js','utf8')
  assert.ok(!bundle.includes('127.0.0.1:38481'))
  assert.ok(!source.includes('v1/native/pair'))
  assert.ok(!source.includes('connection.token'))
})

test('fresh standalone extension starts with no helper on any machine',async()=>{
  const h=makeApi(()=>{throw Error('Network request not expected')})
  const ctl=new NativeController(h.api)
  await ctl.start()
  clearInterval(ctl.timer)
  assert.equal(h.commands.size,12)
  assert.equal(h.files.has('connection.json'),false)
  assert.equal(h.config.get('accountItems').length,3)
  assert.equal(h.config.get('webdavItems')[0].name,'LX N Music  ·  未连接')
  // 'Sync' without credentials is a native prompt, not a localhost request.
  await h.commands.get('sync')()
  assert.ok(h.dialogs.some(([msg])=>String(msg).includes('请先登录账号')))
  assert.equal(h.smsCount(),0)
})

test('NetEase plugin-native SMS login and account songs require no Electron helper',async()=>{
  const paths=[]
  const h=makeApi((url)=>{
    const path=new URL(url).pathname
    paths.push(path)
    if(path.endsWith('sms/captcha/sent'))return reply({code:200})
    if(path.endsWith('login/cellphone'))return reply({code:200},{'set-cookie':['MUSIC_U=demo-token; Path=/; HttpOnly','__csrf=token; Path=/']})
    if(path.endsWith('nuser/account/get'))return reply({code:200,account:{id:1234}})
    if(path.endsWith('user/playlist'))return reply({code:200,playlist:[{id:556,name:'我喜欢的音乐',specialType:5}]})
    if(path.endsWith('v3/playlist/detail'))return reply({code:200,playlist:{trackIds:[{id:34}],trackCount:1}})
    if(path.endsWith('v3/song/detail'))return reply({code:200,songs:[netSong(34)]})
    if(path.endsWith('v3/discovery/recommend/songs'))return reply({code:200,data:{dailySongs:[netSong(35)]}})
    throw Error('Unexpected music path '+path)
  })
  const provider=new NetEaseAccount(h.api)
  await provider.sendSms('13900001001')
  await assert.rejects(provider.sendSms('13900001001'),/稍后/)
  const {cookie,uid}=await provider.loginSms('13900001001','123456')
  assert.equal(uid,1234)
  assert.match(cookie,/MUSIC_U=demo-token/)
  const data=await provider.read(cookie)
  assert.deepEqual(data.lists.map(x=>x.name),['网易云·我喜欢','网易云·每日推荐'])
  assert.ok(data.lists[0].list[0].id.startsWith('wy_'))
  assert.equal(h.smsCount(),1)
  assert.ok(paths.every(x=>x.startsWith('/weapi/')))
})

test('QQ 微信扫码 uses native link button and Tencent HTTPS without a service',async()=>{
  const visited=[]
  const h=makeApi((url,opts)=>{
    visited.push(new URL(url).hostname)
    const target=new URL(url)
    if(target.pathname==='/connect/qrconnect')
      return reply('<html>src="https://open.weixin.qq.com/connect/qrcode/uuid=wxqrlocal001234"</html>')
    if(target.pathname==='/connect/l/qrconnect')
      return reply("window.wx_errcode=200;window.wx_code='wechat-test-auth'")
    if(target.hostname==='u.y.qq.com'){
      const packet=opts.json
      assert.equal(packet['music.login.LoginServer'].method,'Login')
      return reply({code:0,'music.login.LoginServer':{code:0,data:{
        musicid:12345678,musickey:'W_Xtest-session',refresh_token:'refresh-test'
      }}})
    }
    throw Error('Unexpected URL '+url)
  })
  const provider=new QQAccount(h.api)
  const data=await provider.loginWX()
  assert.equal(data.musicId,'12345678')
  assert.equal(data.login_type,1)
  assert.ok(h.dialogs[0][1].buttons.some(b=>b.link?.startsWith('https://open.weixin.qq.com/connect/qrcode/')))
  assert.deepEqual(visited,['open.weixin.qq.com','lp.open.weixin.qq.com','u.y.qq.com'])
})

test('Kugou native SMS uses encrypted request and returns login token without daemon',async()=>{
  const paths=[]
  const h=makeApi((url,opts)=>{
    const u=new URL(url)
    paths.push({host:u.hostname,path:u.pathname,body:opts.text,headers:opts.headers})
    if(u.pathname==='/v7/send_mobile_code')return reply({status:1,data:{status:1}})
    if(u.pathname==='/v7/login_by_verifycode')return reply({status:1,data:{userid:'12345',token:'kugou-test-token'}})
    throw Error('Unexpected Kugou URL')
  })
  const p=new KugouAccount(h.api)
  await p.sendSms('13800002345')
  await assert.rejects(p.sendSms('13800002345'),/稍后/)
  const value=await p.loginSms('13800002345','123456')
  assert.equal(value.userId,'12345')
  assert.equal(value.token,'kugou-test-token')
  assert.deepEqual(paths.map(x=>x.host),['login-user.kugou.com','loginserviceretry.kugou.com'])
  assert.ok(!paths[1].body.includes('123456'))
  assert.ok(JSON.parse(paths[1].body).params.length>32)
  assert.ok(JSON.parse(paths[1].body).pk.length>64)
  assert.equal(paths[1].headers['support-calm'],'1')
  assert.equal(paths[1].headers['x-router'],undefined)
  assert.ok(paths[1].headers['User-Agent'].includes('LOGIN'))
})

test('LX N WebDAV uses extension-native HTTPS request and keeps source playlists',async()=>{
  const h=makeApi((url,opts)=>{
    assert.ok(url.startsWith('https://dav.example.org/dav/LX_Music/playlists.json'))
    assert.ok(opts.headers.Authorization.startsWith('Basic '))
    return reply(JSON.stringify({
      version:'2',data:{
        defaultList:[],loveList:[],userList:[
          {id:'user_1',name:'常听',list:[{
            id:'wy_22',name:'测试',singer:'歌手',source:'wy',meta:{id:22,albumName:'曲目'}
          }]}
        ]
      }
    }))
  })
  const data=await readLX(h.api,{
    url:'https://dav.example.org/dav',username:'test',password:'mock-password',folder:'/LX_Music'
  })
  assert.equal(data.namespace.startsWith('lx:'),true)
  assert.equal(data.lists[2].name,'LX N·常听')
  assert.equal(data.lists[2].list[0].meta.musicId,'22')
})

test('AnyListen isolate has no global URL or URLSearchParams',async()=>{
  const prevURL=globalThis.URL
  const prevSearch=globalThis.URLSearchParams
  globalThis.URL=undefined
  globalThis.URLSearchParams=undefined
  try{
    const h=makeApi((url,opts)=>{
      if(String(url).includes('/connect/qrconnect'))return reply('<html>uuid=qr_isolate_mock_123456789"</html>')
      if(String(url).includes('/connect/l/qrconnect'))
        return reply("window.wx_errcode=200;window.wx_code='wechat-isolate-demo'")
      if(String(url).startsWith('https://u.y.qq.com/')){
        return reply({code:0,'music.login.LoginServer':{code:0,
          data:{musicid:'12345678',musickey:'W_Xtest-key'}}})
      }
      throw Error('Unexpected URL in isolate test: '+url)
    })
    const qq=new QQAccount(h.api)
    const cred=await qq.loginWX()
    assert.equal(cred.musicId,'12345678')
    const kg=new KugouAccount(h.api)
    assert.ok(typeof kg.request==='function')
    // WebDAV validation must never evaluate the missing URL constructor.
    const v=await readLX(makeApi((_url,options)=>reply(JSON.stringify({
      version:'2',data:{defaultList:[],loveList:[],userList:[]}
    }))).api,{
      url:'https://dav.example.org/dav',username:'user',password:'pw',folder:'/LX_Music'
    })
    assert.equal(v.lists.length,2)
  }finally{
    globalThis.URL=prevURL
    globalThis.URLSearchParams=prevSearch
  }
})

test('WebDAV settings restore in place without exposing saved value on settings page',async()=>{
  const h=makeApi(()=>reply(''))
  h.files.set('portable-webdav.json',JSON.stringify({
    url:'https://dav.example.org/dav',username:'demo',password:'fixture',folder:'/LX_Music'
  }))
  const c=new NativeController(h.api)
  await c.start();clearInterval(c.timer)
  assert.equal(h.config.get('webdavUrl'),'https://dav.example.org/dav')
  assert.equal(h.config.get('webdavUsername'),'demo')
  assert.equal(h.config.get('webdavPassword'),'●●●●●●●●')
})

test('NetEase and QQ can import owned browser sessions through native prompt',async()=>{
  const h=makeApi((url,opts)=>{
    if(String(url).includes('nuser/account/get'))return reply({code:200,account:{id:12}})
    if(String(url).includes('musicu.fcg')){
      const key='music.musicasset.PlaylistBaseRead'
      return reply({code:0,[key]:{code:0,data:{v_playlist:[]}}})
    }
    throw Error('Unexpected request')
  })
  const client=new PortableClient(h.api)
  await client.importCookie('netease','MUSIC_U=fixture')
  await client.importCookie('qqmusic','musicid=12345678; qqmusic_key=fixture')
  assert.ok(client.isConnected('netease'))
  assert.ok(client.isConnected('qqmusic'))
  await assert.rejects(client.importCookie('netease','invalid=1'),/MUSIC_U/)
  assert.ok(client.isConnected('netease'))
})

test('Kugou login failure reports a safe server code instead of generic refusal',async()=>{
  const h=makeApi(()=>reply({status:0,error_code:20271}))
  const kg=new KugouAccount(h.api)
  await assert.rejects(
    kg.request('/v7/login_by_verifycode','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',{},
      {plat:1},{baseUrl:'https://loginserviceretry.kugou.com'}),
    /酷狗验证码登录.*20271/
  )
})

test('QQ imported account lists fetch private favorites with encrypted profile ID',async()=>{
  const track={id:100,mid:'003sourceid',name:'收藏音乐',singer:[{name:'歌手'}],
    album:{mid:'a01',name:'专辑'},interval:185}
  let privateRequested=false
  const h=makeApi((url,opts)=>{
    if(String(url).includes('fcg_get_profile_homepage'))
      return reply({data:{creator:{encrypt_uin:'encoded-user'}}})
    if(String(url).includes('musicu.fcg')){
      const packet=opts.json
      const name=Object.keys(packet).find(x=>x!=='comm')
      const req=packet[name]
      let data={}
      if(req.method==='GetPlaylistByUin')
        data={v_playlist:[{dirId:201,tid:987,dirName:'我喜欢'}]}
      else if(req.method==='CgiGetDiss'){
        if(req.param.dirid===201){
          privateRequested=true
          assert.equal(req.param.enc_host_uin,'encoded-user')
        }
        data={songlist:[track],total_song_num:1}
      }else if(req.method==='CgiGetPlaylistFavInfo')data={v_list:[]}
      else if(req.method==='GetRadarSong')data={VecSongs:[{Track:track}]}
      return reply({code:0,[name]:{code:0,data}})
    }
    throw Error('Unexpected QQ source')
  })
  const playlists=await new QQAccount(h.api).read({musicId:'12345678',musicKey:'fixture'})
  assert.equal(privateRequested,true)
  assert.ok(playlists.lists.some(x=>x.name==='QQ音乐·我喜欢'))
  assert.ok(playlists.lists.some(x=>x.name==='QQ音乐·每日推荐'))
})

test('NetEase native QR obtains a session automatically after phone approval',async()=>{
 const hits=[],states=[]
 const h=makeApi((url)=>{
   const path=new URL(url).pathname
   hits.push(path)
   if(path.endsWith('login/qrcode/unikey'))
     return reply({code:200,data:{unikey:'exampleLoginKey123456'}})
   if(path.endsWith('login/qrcode/client/login'))
     return reply({code:803},{'set-cookie':['MUSIC_U=qr-authenticated-session; HttpOnly; Path=/','__csrf=csrf; Path=/']})
   if(path.endsWith('nuser/account/get'))
     return reply({code:200,account:{id:4321}})
   throw Error('Unknown QR flow endpoint: '+path)
 })
 const auth=await new NetEaseAccount(h.api).loginQR(state=>states.push(state))
 assert.ok(auth.cookie.includes('MUSIC_U=qr-authenticated-session'))
 assert.deepEqual(states,['authorizing','validating'])
 assert.ok(h.dialogs[0][1].buttons.some(x=>x.link==='https://music.163.com/login?codekey=exampleLoginKey123456'))
 assert.deepEqual(hits,[
   '/api/login/qrcode/unikey',
   '/api/login/qrcode/client/login',
   '/weapi/nuser/account/get'
 ])
 assert.equal(h.smsCount(),0)
})
test('cancelled NetEase QR does not poll, send SMS or store a credential',async()=>{
 const h=makeApi(url=>{
   if(String(url).includes('/login/qrcode/unikey'))
     return reply({code:200,data:{unikey:'anotherLoginKey987654'}})
   throw Error('Cancelled login must not poll')
 })
 h.api.app.showMessage=async()=>0
 const response=await new NetEaseAccount(h.api).loginQR()
 assert.equal(response,null)
 assert.equal(h.smsCount(),0)
})

test('QQ 微信状态 404 是待确认，405 已授权并立刻换取 QQ 登录态',async()=>{
  const statuses=['408','404','405'],observed=[]
  const h=makeApi((url,opts)=>{
    const route=new URL(url).pathname
    if(route==='/connect/qrconnect')
      return reply('<html>uuid=wx_real_status_abcdefghijk"</html>')
    if(route==='/connect/l/qrconnect'){
      const code=statuses.shift()
      observed.push(code)
      assert.equal(opts.headers.Referer,'https://open.weixin.qq.com/')
      return reply("window.wx_errcode="+code+";window.wx_code='"+(code==='405'?'confirmed-wx-code':'')+"'")
    }
    if(route==='/cgi-bin/musicu.fcg'){
      const request=opts.json['music.login.LoginServer']
      assert.equal(request.param.code,'confirmed-wx-code')
      return reply({code:0,'music.login.LoginServer':{code:0,data:{
        musicid:'12345678',musickey:'W_Xsigned-in'
      }}})
    }
    throw Error('Unexpected QR endpoint '+route)
  })
  const states=[]
  const result=await new QQAccount(h.api).loginWX(state=>states.push(state))
  assert.equal(result.musicId,'12345678')
  assert.deepEqual(observed,['408','404','405'])
  assert.deepEqual(states,['authorizing','authorizing','scanned','validating'])
})
test('QQ confirmed WX authorization without code fails immediately instead of hanging',async()=>{
  const h=makeApi(url=>{
    const route=new URL(url).pathname
    if(route==='/connect/qrconnect')return reply('uuid=wx_confirm_without_code_aabbcc"')
    if(route==='/connect/l/qrconnect')
      return reply("window.wx_errcode=405;window.wx_code=''")
    throw Error('Must not exchange empty auth code')
  })
  await assert.rejects(new QQAccount(h.api).loginWX(),/已确认.*授权信息为空/)
})
test('NetEase QR application rejects empty public API response with useful explanation',async()=>{
  const h=makeApi(url=>{
    if(String(url).includes('/api/login/qrcode/unikey'))return reply('')
    throw Error('No polling permitted')
  })
  await assert.rejects(new NetEaseAccount(h.api).loginQR(),/二维码申请失败.*有效数据/)
})
test('Kugou SMS error 20006 offers a QR fallback without storing verification codes',async()=>{
  const endpoints=[]
  let inputs=0
  const h=makeApi((url,opts)=>{
    const path=new URL(url).pathname
    endpoints.push(path)
    if(path==='/v7/send_mobile_code')return reply({status:1,data:{status:1}})
    if(path==='/v7/login_by_verifycode')
      return reply({status:0,error_code:20006,details:'Sensitive token should stay hidden'})
    if(path==='/v2/qrcode')
      return reply({status:1,data:{qrcode:'kugou-qr-demo-aabbccdd'}})
    if(path==='/v2/get_userinfo_qrcode')
      return reply({status:1,data:{status:4,userid:'55555',token:'fixture-kugou-token'}})
    throw Error('Unexpected Kugou endpoint '+path)
  })
  h.api.app.showInputDialog=async()=>{
    return ++inputs===1?'13800002345':'123456'
  }
  const account=new PortableClient(h.api)
  const ok=await account.login('kugou',()=>{})
  assert.equal(ok,true)
  assert.ok(account.isConnected('kugou'))
  assert.equal(account.credentials.kugou.token,'fixture-kugou-token')
  assert.deepEqual(endpoints,['/v7/send_mobile_code','/v7/login_by_verifycode',
    '/v2/qrcode','/v2/get_userinfo_qrcode'])
  assert.ok(h.dialogs.some(([message,opts])=>String(message).includes('20006')&&opts?.buttons))
  assert.ok(h.dialogs.some(([message,opts])=>opts?.buttons?.some(b=>b.link?.startsWith('https://h5.kugou.com/'))))
  assert.ok(!h.files.get('portable-accounts.json').includes('123456'))
})
