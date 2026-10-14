import {platformRequest, mergeCookies, cookiePairs, asObject, stringOf, songDuration} from './portable-utils.mjs'

// Uses the WEAPI algorithm already adopted by the official Online Metadata
// extension. The user's password and SMS code never enter extension storage.
const pub = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'
const iv = '0102030405060708'
const preset = '0CoJUm6Qyw8W8jud'
const encode = async(api, body) => {
  const secretBytes = await api.utils.crypto.randomBytes(16)
  const hex = await api.utils.dataConverter(new Uint8Array(secretBytes), 'hex')
  const secret = hex.slice(0,16)
  const c = api.utils.crypto
  const first = await c.aesEncrypt('CBC_128_PKCS7Padding',JSON.stringify(body),preset,iv)
  const second = await c.aesEncrypt('CBC_128_PKCS7Padding',first,secret,iv)
  const encrypted = await c.rsaEncrypt('RSA_NO_PADDING',
    new Uint8Array(await api.utils.dataConverter(secret)).reverse(),
    await api.utils.dataConverter(pub))
  const b64 = await api.utils.dataConverter(encrypted,'base64')
  return { params: second, encSecKey: await api.utils.dataConverter(b64,'base64','hex') }
}
export async function wyRequest(api, route, cookie='', data={}) {
  if (!/^[a-z0-9/_-]+$/i.test(route)) throw new Error('请求路径错误')
  const csrf = cookiePairs(cookie).get('__csrf') ?? ''
  const enc = await encode(api,{ ...data,csrf_token:csrf })
  const response = await platformRequest(api,'https://music.163.com/weapi/'+route,{
    method:'POST', form:enc,
    headers:{
      'User-Agent':'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36',
      Referer:'https://music.163.com/',Origin:'https://music.163.com',
      ...(cookie?{Cookie:cookie}:{})
    }
  })
  if (!response.body || Number(response.body.code)!==200)
    throw new Error('网易云请求失败：'+String(response.body?.code ?? '未知'))
  return response
}
export const convertWYSong = (s) => {
  if (!s || !Number.isSafeInteger(Number(s.id)) || !s.name) return null
  const meta=s.al??{}, singers=Array.isArray(s.ar)?s.ar.map(x=>x.name).filter(Boolean):[]
  return {
    id:'wy_'+s.id,name:s.name,singer:singers.join('、'),isLocal:false,
    interval:songDuration(Number(s.dt)/1000),
    meta:{
      source:'wy',musicId:String(s.id),albumId:meta.id,albumName:meta.name??'',
      picUrl:meta.picUrl??'',qualitys:{},createTime:0,updateTime:0,posTime:0
    }
  }
}
export class NetEaseAccount {
  constructor(api){ this.api=api; this.pending=new Map() }
  async sendSms(phone) {
    if(!/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确')
    const now=Date.now(), previous=this.pending.get(phone)
    if(previous && now-previous.at<60_000) throw new Error('请稍后再获取验证码')
    const response=await wyRequest(this.api,'sms/captcha/sent',previous?.cookie??'',{cellphone:phone,phone,ctcode:'86'})
    this.pending.set(phone,{at:now,cookie:mergeCookies(previous?.cookie??'',response.headers)})
  }
  async loginSms(phone,code){
    if(!/^1\d{10}$/.test(phone)|| !/^\d{4,8}$/.test(code)) throw new Error('手机号或验证码格式不正确')
    const state=this.pending.get(phone)
    if(!state || Date.now()-state.at>5*60_000)throw new Error('验证码已过期，请重新获取')
    const reply=await wyRequest(this.api,'login/cellphone',state.cookie,
      {phone,captcha:code,countrycode:'86',rememberLogin:'true'})
    const cookie=mergeCookies(state.cookie,reply.headers)
    if(!cookiePairs(cookie).get('MUSIC_U'))throw new Error('网易云没有返回登录凭据，请使用官网完成账号安全验证')
    const uid=await this.uid(cookie)
    this.pending.delete(phone)
    return {cookie,uid}
  }
  async uid(cookie){
    if(!cookiePairs(cookie).get('MUSIC_U'))throw new Error('网易云登录已失效')
    const {body}=await wyRequest(this.api,'nuser/account/get',cookie,{})
    if(!body.account?.id)throw new Error('网易云登录已失效')
    return body.account.id
  }
  async refresh(cookie){
    const reply=await wyRequest(this.api,'login/token/refresh',cookie,{})
    const merged=mergeCookies(cookie,reply.headers)
    await this.uid(merged)
    return merged
  }
  async read(cookie){
    const uid=await this.uid(cookie),lists=[],items=[]
    for(let offset=0;offset<3000;offset+=200){
      const {body}=await wyRequest(this.api,'user/playlist',cookie,{uid,offset,limit:200,total:true})
      if(!Array.isArray(body.playlist))throw new Error('网易云歌单目录不完整')
      items.push(...body.playlist)
      if(body.playlist.length<200)break
    }
    for(const item of items){
      const {body}=await wyRequest(this.api,'v3/playlist/detail',cookie,{id:item.id,n:100000,s:8})
      const tracks=body.playlist?.trackIds
      if(!Array.isArray(tracks))throw new Error('网易云歌单歌曲 ID 不完整')
      if(body.playlist.trackCount>tracks.length)throw new Error('网易云歌单分页不完整')
      const songs=await this.songs(cookie,tracks.map(v=>v.id))
      const favorite=item.specialType===5||/喜欢的音乐$/.test(item.name)
      lists.push({key:'playlist:'+item.id,name:favorite?'网易云·我喜欢':'网易云·'+item.name,list:songs})
    }
    if(!lists.some(x=>x.name==='网易云·我喜欢')){
      try{
        const {body}=await wyRequest(this.api,'song/like/get',cookie,{uid:String(uid)})
        if(Array.isArray(body.ids))lists.push({key:'love',name:'网易云·我喜欢',list:await this.songs(cookie,body.ids)})
      }catch{/* A private favorite list must not prevent daily recommendations. */}
    }
    try{
      const {body}=await wyRequest(this.api,'v3/discovery/recommend/songs',cookie,{offset:0,total:true,limit:30})
      if(Array.isArray(body.data?.dailySongs)){
        const songs=body.data.dailySongs.map(convertWYSong).filter(Boolean)
        if(songs.length)lists.push({key:'daily',name:'网易云·每日推荐',list:songs})
      }
    }catch{/* Daily unavailable is not a failed account login. */}
    if(!lists.length)throw new Error('网易云暂时没有返回账号歌单或每日推荐')
    return {namespace:'netease:'+uid,lists}
  }
  async songs(cookie,ids){
    const result=[]
    for(let start=0;start<ids.length;start+=300){
      const chunk=ids.slice(start,start+300)
      const {body}=await wyRequest(this.api,'v3/song/detail',cookie,{c:JSON.stringify(chunk.map(id=>({id})))})
      if(!Array.isArray(body.songs))throw new Error('网易云歌曲详情不完整')
      const map=new Map(body.songs.map(x=>[x.id,x]))
      for(const id of chunk){
        const info=convertWYSong(map.get(id))
        if(!info)throw new Error('网易云歌曲详情缺失')
        result.push(info)
      }
    }
    return result
  }
}
