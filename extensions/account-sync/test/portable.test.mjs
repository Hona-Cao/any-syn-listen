import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import {NativeController} from '../src/native-controller.mjs'
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
  assert.equal(h.commands.size,6)
  assert.equal(h.files.has('connection.json'),false)
  assert.equal(h.config.get('accountItems').length,3)
  assert.equal(h.config.get('webdavItems')[0].name,'未设置')
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
    paths.push({host:u.hostname,path:u.pathname,body:opts.text})
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
