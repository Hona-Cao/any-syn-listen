import {platformRequest,asObject,stringOf,songDuration,wait,encodeQuery,cookiePairs} from './portable-utils.mjs'

const endpoint='https://u.y.qq.com/cgi-bin/musicu.fcg'
const wxAppId='wx48db31d50e334801'
const referer='https://y.qq.com/'
const musicFile = (song) => song.file ?? {}

export const convertQQ = (song) => {
  if(!song || !song.mid || !(song.name||song.title))return null
  const file=musicFile(song),album=song.album??{}, q={}
  const size=(n)=>n>0?(n/1048576).toFixed(2)+' MB':null
  if(file.size_128mp3)q['128k']={sizeStr:size(file.size_128mp3)}
  if(file.size_320mp3)q['320k']={sizeStr:size(file.size_320mp3)}
  if(file.size_flac)q.flac={sizeStr:size(file.size_flac)}
  if(file.size_hires)q.flac24bit={sizeStr:size(file.size_hires)}
  return {
    id:'tx_'+song.mid, name:song.title??song.name,
    singer:Array.isArray(song.singer)?song.singer.map(x=>x.name).filter(Boolean).join('、'):'',
    interval:songDuration(song.interval),isLocal:false,
    meta:{source:'tx',musicId:song.mid,songId:String(song.id??''),
      albumId:album.mid??'',albumName:album.name??'',
      picUrl:album.mid?'https://y.gtimg.cn/music/photo_new/T002R500x500M000'+album.mid+'.jpg':'',
      qualitys:q,createTime:0,updateTime:0,posTime:0
    }
  }
}
export class QQAccount {
  constructor(api){this.api=api}
  async call(module,method,param={},cred={},commOverrides={}) {
    const key=module
    const id=stringOf(cred.musicId??cred.musicid)
    const token=stringOf(cred.musicKey??cred.musickey)
    const comm={
      ct:11,cv:4747474,v:4747474,tmeAppID:'qqmusic',
      format:'json',inCharset:'utf-8',outCharset:'utf-8',
      uid:id||'0',loginUin:id||'0',qq:id||'0',authst:token,
      ...(token?{tmeLoginType:token.startsWith('W_X')?1:2}:{}),
      ...commOverrides
    }
    const cookie = cred.cookie || (token&&id ? [
      'uin='+id,'musicid='+id,'qqmusic_key='+token,'qm_keyst='+token,
    ].join('; ') : '')
    const {body}=await platformRequest(this.api,endpoint,{
      method:'POST',
      json:{comm,[key]:{module,method,param}},
      headers:{Origin:referer,Referer:referer,...(cookie?{Cookie:cookie}:{})}
    })
    const result=body?.[key]
    if(!result||Number(result.code)!==0||!isValidData(result.data)) {
      throw new Error('QQ音乐账号接口暂时不可用'+(result?.code!=null?'（'+String(result.code)+'）':''))
    }
    return result.data
  }
  async loginWX(onStatus=()=>{}){
    const qrURL = 'https://open.weixin.qq.com/connect/qrconnect?'
    const qrParams = {
      appid:wxAppId,
      redirect_uri:'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/',
      response_type:'code',scope:'snsapi_login',state:'STATE',
      href:'https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect'
    }
    const qrLink = qrURL+encodeQuery(qrParams)
    const page=await platformRequest(this.api,qrLink,{method:'GET'})
    const html=typeof page.body==='string'?page.body:''
    const uuid=/uuid=([^"&\s]+)/.exec(html)?.[1]
    if(!uuid||!/^[a-zA-Z0-9_@+=-]{10,200}$/.test(uuid))
      throw new Error('微信登录暂时无法生成二维码')
    const imageURL='https://open.weixin.qq.com/connect/qrcode/'+encodeURIComponent(uuid)
    onStatus('authorizing')
    const choice=await this.api.app.showMessage('请在浏览器打开二维码，用微信扫码并在手机上确认。确认后会自动返回登录结果。',{modal:true,buttons:[
      {text:'取消'},{text:'打开微信二维码',link:imageURL}
    ]})
    if(choice!==1)return null
    onStatus('authorizing')
    let code=null
    const deadline=Date.now()+90000
    let networkFailures=0
    while(Date.now()<deadline){
      await wait(1800)
      let result
      try{
        result=await platformRequest(this.api,
          'https://lp.open.weixin.qq.com/connect/l/qrconnect?uuid='+encodeURIComponent(uuid)+'&_='+Date.now(),
          {method:'GET',timeout:12000})
      }catch{
        networkFailures++
        if(networkFailures>=4)throw new Error('微信扫码状态无法查询，请检查网络或代理后重试')
        continue
      }
      networkFailures=0
      const body=typeof result.body==='string'?result.body:''
      const match=/window\.wx_errcode=(\d+);window\.wx_code='([^']*)'/.exec(body)
      if(!match)continue
      if(match[1]==='200' && match[2]){code=match[2];break}
      if(match[1]==='405')onStatus('scanned')
      if(match[1]==='402'||match[1]==='403')throw new Error('微信授权已取消或二维码已过期')
    }
    if(!code)throw new Error('微信扫码在 90 秒内未完成授权，请重试')
    onStatus('validating')
    const data=await this.call('music.login.LoginServer','Login',
      {code,strAppid:wxAppId},{},{tmeLoginType:1})
    const musicId=stringOf(data.musicid??data.musicId??data.str_musicid)
    const musicKey=stringOf(data.musickey??data.musicKey)
    if(!/^\d{4,20}$/.test(musicId)||!musicKey)
      throw new Error('微信已授权，但 QQ音乐没有返回有效登录凭据')
    return {musicId,musicKey,
      login_type:1,refresh_key:data.refresh_key,refresh_token:data.refresh_token,
      openid:data.openid,unionid:data.unionid}
  }
  async validate(credential){
    const x=await this.call('music.musicasset.PlaylistBaseRead','GetPlaylistByUin',
      {uin:credential.musicId},credential)
    if(!Array.isArray(x.v_playlist))throw new Error('QQ音乐没有返回用户歌单')
  }
  async getEncryptedUin(cred) {
    const url='https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?'+encodeQuery({
      ct:20,cv:4747474,cid:205360838,userid:cred.musicId
    })
    const response=await platformRequest(this.api,url,{method:'GET',headers:{
      Referer:'https://y.qq.com/',...(cred.cookie?{Cookie:cred.cookie}:{})
    }})
    return String(response.body?.data?.creator?.encrypt_uin??'')
  }
  async read(cred){
    if(!cred?.musicId||!cred?.musicKey)throw new Error('请登录 QQ音乐账号')
    const lists=[],seen=new Set()
    let euin=''
    try{euin=await this.getEncryptedUin(cred)}catch{}
    const data=await this.call('music.musicasset.PlaylistBaseRead','GetPlaylistByUin',
      {uin:cred.musicId},cred)
    const folders=data.v_playlist
    if(!Array.isArray(folders))throw new Error('QQ音乐歌单目录不完整')
    for(const item of folders){
      const dissId=item.tid??0,dirId=item.dirId??0,key=dirId===201?'love':'playlist:'+(dissId||dirId)
      if(!dissId&&!dirId||seen.has(key))continue
      seen.add(key)
      try{
        const songs=await this.details(cred,dissId,dirId===201?201:0,dirId===201?euin:'')
        lists.push({key,name:dirId===201?'QQ音乐·我喜欢':'QQ音乐·'+(item.dirName??item.name??'歌单'),list:songs})
      }catch{/* One unavailable list must not hide daily recommendations. */}
    }
    // On some accounts the favorites folder is absent from the main index.
    if(!seen.has('love')){
      try{
        const songs=await this.details(cred,0,201,euin)
        if(songs.length)lists.push({key:'love',name:'QQ音乐·我喜欢',list:songs})
      }catch{/* Account may have a private or empty favorites folder. */}
    }
    if(euin){
      try{
        const favorites=await this.call('music.musicasset.PlaylistFavRead','CgiGetPlaylistFavInfo',{
          uin:euin,offset:0,size:100
        },cred)
        if(Array.isArray(favorites.v_list)){
          for(const favorite of favorites.v_list){
            const dissId=favorite.id??favorite.tid??0,key='fav:'+dissId
            if(!dissId||seen.has(key))continue
            seen.add(key)
            try{
              const songs=await this.details(cred,dissId,0)
              lists.push({key,name:'QQ音乐·'+(favorite.title??favorite.name??'收藏歌单'),list:songs})
            }catch{}
          }
        }
      }catch{}
    }
    try{
      let songs=[]
      try{
        const data=await this.call('music.recommend.TrackRelationServer','GetRadarSong',
          {Page:1,ReqType:0,FavSongs:[],EntranceSongs:[]},cred)
        songs=extractTracks(data).map(convertQQ).filter(Boolean)
      }catch{}
      if(!songs.length){
        const data=await this.call('music.radioProxy.MbTrackRadioSvr','get_radio_track',
          {id:99,num:30,from:0,scene:0,song_ids:[]},cred)
        songs=extractTracks(data).map(convertQQ).filter(Boolean)
      }
      if(songs.length)lists.push({key:'daily',name:'QQ音乐·每日推荐',list:songs})
    }catch{/* Recommendation endpoint may be temporarily unavailable. */}
    if(!lists.length)throw new Error('QQ音乐暂无可用的账号歌单或每日推荐')
    return {namespace:'qqmusic:'+cred.musicId,lists}
  }
  async details(cred,dissId,dirId,encryptedUin=''){
    const songs=[]
    for(let page=0;page<100;page++){
      const data=await this.call('music.srfDissInfo.DissInfo','CgiGetDiss',{
        disstid:dissId,dirid:dirId,tag:true,song_begin:page*200,song_num:200,
        userinfo:true,orderlist:true,onlysonglist:false,
        ...(encryptedUin?{enc_host_uin:encryptedUin}:{})
      },cred)
      const rows=data.songlist
      if(!Array.isArray(rows))throw new Error('QQ音乐歌单详情不完整')
      for(const row of rows){
        const info=convertQQ(row)
        if(!info)throw new Error('QQ音乐歌曲信息不完整')
        songs.push(info)
      }
      const count=data.total_song_num
      if(typeof count==='number'&&songs.length>=count) return songs
      if(rows.length<200)return songs
    }
    throw new Error('QQ音乐歌曲数量过多，超过分页上限')
  }
}
const isValidData=(data)=>data!==undefined&&data!==null
const extractTracks=(data)=>{
  if(Array.isArray(data?.VecSongs))return data.VecSongs.map(v=>v.Track).filter(Boolean)
  if(Array.isArray(data?.tracks))return data.tracks
  if(Array.isArray(data?.songlist))return data.songlist
  return []
}
