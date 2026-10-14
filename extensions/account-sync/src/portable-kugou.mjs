import CryptoJS from 'crypto-js'
import {platformRequest, asObject, stringOf, songDuration, md5, encodeQuery} from './portable-utils.mjs'
const kgKey='OIlwieks28dk2k092lksi2UIkp'
const kgLoginKey='NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
const pub='-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB\n-----END PUBLIC KEY-----'
const value=(x)=>x===null||x===undefined?'':String(x)
const rowsOf=(data)=>{
  const d=asObject(data), nested=asObject(d.data)
  return [d.info,d.list,d.items,d.songs,d.songlist,d.song_list,nested.info,nested.list,nested.items,nested.songs].find(Array.isArray)??null
}
export const convertKG = (item) => {
  const data=asObject(item), extra=asObject(data.audio_info), album=asObject(data.album_info)
  const hash=stringOf(data.hash??data.filehash??extra.hash).toUpperCase()
  const audioId=stringOf(extra.audio_id??data.audio_id??data.audioid??data.album_audio_id)
  const name=stringOf(data.songname??data.ori_audio_name??data.audio_name??data.name)
  if(!/^[A-F0-9]{32}$/.test(hash)||!/^\d+$/.test(audioId)||!name)return null
  const q={'128k':{hash,sizeStr:null}}, sizes=[[ '320k','hash_320','filesize_320'],['flac','hash_flac','filesize_flac'],['flac24bit','hash_high','filesize_high']]
  for(const [type,h,s] of sizes){
    const file=stringOf(extra[h]??data[h]).toUpperCase()
    if(/^[A-F0-9]{32}$/.test(file))q[type]={hash:file,sizeStr:Number(data[s]??extra[s])>0?(Number(data[s]??extra[s])/1048576).toFixed(2)+' MB':null}
  }
  return {
    id:'kg_'+audioId+'_'+hash,name,singer:stringOf(data.author_name??data.singername??data.singer),
    interval:songDuration(Number(extra.timelength??data.timelength)/1000),
    isLocal:false,meta:{
      source:'kg',musicId:audioId,hash,albumAudioId:stringOf(extra.audio_group_id??data.album_audio_id),
      albumId:stringOf(album.album_id??data.album_id),albumName:stringOf(album.album_name??data.album_name),
      qualitys:q,createTime:0,updateTime:0,posTime:0
    }
  }
}
export class KugouAccount {
  constructor(api){this.api=api;this.pending=new Map()}
  async request(route,mid,params={},body=null,options={}) {
    if(!/^\/[a-z0-9/_-]+$/i.test(route)||!/^[a-f0-9]{32}$/i.test(mid))throw new Error('酷狗请求参数无效')
    const login=options.login??false
    const payload={dfid:'-',mid,uuid:'-',appid:1005,clientver:20489,
      clienttime:Math.floor(Date.now()/1000),...params}
    const json=body?JSON.stringify(body):''
    const salt=login?kgLoginKey:kgKey
    const signature=await md5(this.api,salt+
      Object.keys(payload).sort().map(k=>k+'='+value(payload[k])).join('')+json+salt)
    const url=(options.baseUrl??(login?'https://login-user.kugou.com':'https://gateway.kugou.com'))+
      route+'?'+encodeQuery({...Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,value(v)])),signature})
    const {body:resp}=await platformRequest(this.api,url,{
      method:body?'POST':'GET',
      headers:{
        'Content-Type':'application/json',
        'User-Agent':'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
        'kg-rc':'1','kg-thash':'5d816a0','kg-rec':'1','kg-rf':'B9EDA08A64250DEFFBCADDEE00F8F25F',
        mid,dfid:'-',clienttime:value(payload.clienttime),
        ...(!login?{'x-router':options.router??'cloudlist.service.kugou.com'}:{})
      },
      ...(body?{text:json}:{})
    })
    if(Number(resp?.status)!==1 || (resp.error_code!=null && Number(resp.error_code)!==0))
      throw new Error('酷狗接口暂时不可用')
    return Array.isArray(resp.data)?{items:resp.data}:asObject(resp.data)
  }
  async randomHex(bytes){
    const value=await this.api.utils.crypto.randomBytes(bytes)
    return await this.api.utils.dataConverter(new Uint8Array(value),'hex')
  }
  async aesSecret(secret){
    const hash=await md5(this.api,secret)
    return {key:CryptoJS.enc.Utf8.parse(hash.slice(0,32)),
      iv:CryptoJS.enc.Utf8.parse(hash.slice(-16))}
  }
  async encrypt(text,secret){
    const {key,iv}=await this.aesSecret(secret)
    return CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(text),key,{iv,mode:CryptoJS.mode.CBC,padding:CryptoJS.pad.Pkcs7}).ciphertext.toString(CryptoJS.enc.Hex)
  }
  async decrypt(text,secret){
    const {key,iv}=await this.aesSecret(secret)
    return CryptoJS.AES.decrypt({ciphertext:CryptoJS.enc.Hex.parse(text)},key,
      {iv,mode:CryptoJS.mode.CBC,padding:CryptoJS.pad.Pkcs7}).toString(CryptoJS.enc.Utf8)
  }
  async rsa(text){
    const data=await this.api.utils.dataConverter(text),buf=new Uint8Array(128)
    if(data.length>128)throw new Error('酷狗加密参数过长')
    buf.set(data)
    const encrypted=await this.api.utils.crypto.rsaEncrypt('RSA_NO_PADDING',buf,await this.api.utils.dataConverter(pub))
    const b64=await this.api.utils.dataConverter(encrypted,'base64')
    return String(await this.api.utils.dataConverter(b64,'base64','hex')).toUpperCase()
  }
  async sendSms(phone){
    if(!/^1\d{10}$/.test(phone))throw new Error('手机号格式不正确')
    const now=Date.now(),state=this.pending.get(phone)
    if(state && now-state.at<60000)throw new Error('请稍后再获取验证码')
    const mid=state?.mid??await this.randomHex(16)
    await this.request('/v7/send_mobile_code',mid,{},{
      businessid:5,mobile:phone,plat:3
    },{baseUrl:'https://login-user.kugou.com'})
    this.pending.set(phone,{at:now,mid})
  }
  async loginSms(phone,code){
    if(!/^1\d{10}$/.test(phone)||!/^\d{4,8}$/.test(code))throw new Error('手机号或验证码格式不正确')
    const state=this.pending.get(phone)
    if(!state || Date.now()-state.at>5*60000)throw new Error('验证码已过期，请重新获取')
    const now=Date.now(),secret=await this.randomHex(8)
    const key=await md5(this.api,'1005'+kgKey+'20489'+now)
    const body={
      plat:1,support_multi:1,t1:0,t2:0,t3:'MCwwLDAsMCwwLDAsMCwwLDA=',
      clienttime_ms:now,mobile:phone.slice(0,2)+'*****'+phone.slice(-1),
      key,pk:await this.rsa(JSON.stringify({clienttime_ms:now,key:secret})),
      params:await this.encrypt(JSON.stringify({mobile:phone,code}),secret)
    }
    const response=await this.request('/v7/login_by_verifycode',state.mid,{},body,
      {baseUrl:'https://loginserviceretry.kugou.com'})
    let values=response
    if(typeof response.secu_params==='string' && response.secu_params){
      const decrypted=JSON.parse(await this.decrypt(response.secu_params,secret))
      values=typeof decrypted==='string'?{...response,token:decrypted}:{...response,...asObject(decrypted)}
    }
    const account={userId:stringOf(values.userid??values.user_id),token:stringOf(values.token),mid:state.mid}
    if(!/^\d{1,20}$/.test(account.userId)||!account.token)throw new Error('酷狗未返回有效登录凭据')
    this.pending.delete(phone)
    return account
  }
  async enrich(rows){
    const missing=[]
    rows.forEach((raw,index)=>{
      const data=asObject(raw),info=asObject(data.audio_info)
      if(convertKG(raw))return
      const hash=stringOf(data.hash??data.filehash??info.hash).toUpperCase()
      if(!/^[A-F0-9]{32}$/.test(hash))throw new Error('酷狗歌曲 hash 不完整')
      missing.push({hash,index})
    })
    for(let offset=0;offset<missing.length;offset+=100){
      const batch=missing.slice(offset,offset+100)
      const {body}=await platformRequest(this.api,'https://gateway.kugou.com/v2/album_audio/audio',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-router':'kmr.service.kugou.com',
          'KG-THash':'13a3164','KG-RC':'1','KG-Fake':'0','KG-RF':'00869891',
          'User-Agent':'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi'},
        json:{area_code:'1',show_privilege:1,show_album_info:'1',is_publish:'',appid:1005,
          clientver:11451,mid:'1',dfid:'-',clienttime:Date.now(),key:kgKey,
          fields:'album_info,author_name,audio_info,ori_audio_name,base,songname',
          data:batch.map(({hash})=>({hash}))}
      })
      if(Number(body?.error_code)!==0 || !Array.isArray(body.data)||body.data.length!==batch.length)
        throw new Error('酷狗歌曲信息无法补齐')
      batch.forEach(({index,hash},i)=>{
        const info=asObject(Array.isArray(body.data[i])?body.data[i][0]:body.data[i])
        if(!Object.keys(info).length)throw new Error('酷狗歌曲信息缺失')
        rows[index]={...rows[index],...info,hash,audio_info:{
          ...asObject(rows[index].audio_info),...asObject(info.audio_info)}}
      })
    }
    return rows
  }
  async detail(account,item){
    const songs=[],seen=new Set()
    for(let page=1;page<=100;page++){
      const data=await this.request('/v4/get_list_all_file_v3',account.mid,
        {userid:account.userId,token:account.token},{
          listid:item.id,userid:account.userId,token:account.token,type:item.type,
          page,pagesize:300,area_code:1,allplatform:1,show_cover:1
        })
      const rows=rowsOf(data)
      if(!rows)throw new Error('酷狗歌曲列表不完整')
      for(const raw of await this.enrich(rows.map(asObject))){
        const song=convertKG(raw)
        if(!song)throw new Error('酷狗歌曲内容不完整')
        if(!seen.has(song.id)){seen.add(song.id);songs.push(song)}
      }
      if(data.count!=null && songs.length>=Number(data.count))return songs
      if(rows.length<300)return songs
    }
    throw new Error('酷狗歌曲过多，超过分页上限')
  }
  async daily(account){
    const data=await this.request('/everyday_song_recommend',account.mid,
      {token:account.token,userid:account.userId,platform:'android'},
      {platform:'android',userid:account.userId},{router:'everydayrec.service.kugou.com'})
    const rows=rowsOf(data)
    if(!Array.isArray(rows)||!rows.length)return null
    const normalized=rows.map(row=>asObject(row.song_info??row.songInfo??row.song??row))
    const songs=(await this.enrich(normalized)).map(convertKG).filter(Boolean)
    return songs.length?{key:'daily',name:'酷狗·每日推荐',list:songs}:null
  }
  async read(account){
    if(!/^\d{1,20}$/.test(account?.userId??'')||!account?.token||!/^[a-f0-9]{32}$/i.test(account.mid))
      throw new Error('请登录酷狗账号')
    const lists=[],mirrors=[],errors=[]
    try{
      for(let page=1;page<=100;page++){
        const data=await this.request('/v7/get_all_list',account.mid,
          {plat:1,userid:Number(account.userId),token:account.token},
          {userid:account.userId,token:account.token,total_ver:0,type:2,page,pagesize:100})
        const rows=rowsOf(data)
        if(!rows)throw new Error('酷狗没有返回歌单')
        for(const raw of rows){
          const row=asObject(raw),id=stringOf(row.listid??row.list_id)
          if(!/^\d{1,20}$/.test(id))continue
          const type=Number(row.type??row.list_type)===1?1:0
          if(!lists.some(x=>x.id===id&&x.type===type))
            lists.push({id,type,name:stringOf(row.name??row.listname??row.list_name)||(id==='0'?'我喜欢':'歌单'),
              count:Number(row.count??row.songcount??0)})
        }
        if(rows.length<100 || Number(data.total)>=0 && lists.length>=Number(data.total))break
      }
    }catch(e){errors.push('歌单目录：'+e.message)}
    for(const item of lists){
      try{
        const songs=await this.detail(account,item)
        if(item.count>0&&!songs.length)throw new Error('歌曲读取失败')
        const liked=item.type===0&&(item.id==='0'||/^(我喜欢|我的喜欢|喜欢的音乐)$/.test(item.name))
        mirrors.push({key:item.type===1?'fav:'+item.id:'playlist:'+item.id,
          name:liked?'酷狗·我喜欢':'酷狗·'+item.name,list:songs})
      }catch(e){errors.push('歌单：'+e.message)}
    }
    try{const daily=await this.daily(account);if(daily)mirrors.push(daily)}
    catch(e){errors.push('日推：'+e.message)}
    if(!mirrors.length)throw new Error(errors.join('；')||'酷狗没有返回账号歌单或每日推荐')
    return {namespace:'kugou:'+account.userId,lists:mirrors}
  }
}
