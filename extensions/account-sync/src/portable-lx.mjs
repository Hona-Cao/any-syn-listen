import {platformRequest, basicAuthorization, sha256, asObject, stringOf, parseEndpoint} from './portable-utils.mjs'
const sources=/^[a-z][a-z0-9_-]{0,30}$/i
export const convertLX = (s) => {
  if(!s||!s.id||!s.name||s.source==='local')return null
  const source=s.source||String(s.id).split('_')[0]
  if(!sources.test(source))return null
  const meta=asObject(s.meta), qualitys={}
  for(const [k,v] of Object.entries(asObject(meta._qualitys))){
    const key=k==='flac32bit'?'flac24bit':k
    if(['128k','320k','flac','flac24bit','192k','wav','dolby','master'].includes(key)&&v)
      qualitys[key]={sizeStr:typeof v.size==='string'?v.size:null}
  }
  const {_qualitys,...other}=meta
  return {id:s.id,name:s.name,singer:s.singer??'',interval:s.interval??null,isLocal:false,
    meta:{...other,source,musicId:stringOf(meta.songId??meta.id??s.id),
      albumName:meta.albumName??'',picUrl:meta.picUrl??'',qualitys,
      createTime:0,updateTime:0,posTime:0}}
}
export function parseLX(raw) {
  const value=typeof raw==='string'?JSON.parse(raw):raw
  const data=value?.data
  if(!data||!Array.isArray(data.defaultList)||!Array.isArray(data.loveList)||!Array.isArray(data.userList))
    throw new Error('LX N WebDAV 文件格式不正确')
  const fromSongs=(list)=>{
    if(!Array.isArray(list))throw new Error('LX N 歌单歌曲格式错误')
    return list.map(convertLX).filter(Boolean)
  }
  const result=[
    {key:'default',name:'LX N·试听列表',list:fromSongs(data.defaultList)},
    {key:'love',name:'LX N·我的收藏',list:fromSongs(data.loveList)}
  ],seen=new Set()
  for(const playlist of data.userList){
    if(!playlist||typeof playlist.id!=='string'||typeof playlist.name!=='string')continue
    if(seen.has(playlist.id))continue
    seen.add(playlist.id)
    result.push({key:'user:'+playlist.id,name:'LX N·'+playlist.name,list:fromSongs(playlist.list)})
  }
  return result
}
export const validateDAV = (cfg) => {
  const u=parseEndpoint(cfg.url)
  if(u.protocol!=='https:'||u.authority.includes('@')||!cfg.username||!cfg.password)throw new Error('请填写 HTTPS WebDAV 地址与账号')
  if(!/^\/?[-\w/ .]*$/.test(cfg.folder??'/LX_Music'))throw new Error('WebDAV 歌单目录格式错误')
}
export async function readLX(api, cfg) {
  validateDAV(cfg)
  const folder='/'+(cfg.folder||'LX_Music').replace(/^\/+|\/+$/g,'')
  const url=cfg.url.replace(/\/+$/,'')+folder+'/playlists.json'
  const auth=await basicAuthorization(api,cfg.username,cfg.password)
  const reply=await platformRequest(api,url,{externalDav:true,
    method:'GET',headers:{Authorization:auth}})
  const raw=typeof reply.body==='string'?reply.body:reply.raw&&reply.raw.length?
    await api.utils.dataConverter(reply.raw,'utf-8'):JSON.stringify(reply.body)
  if(raw.length>30*1024*1024)throw new Error('LX N 歌单文件过大')
  const lists=parseLX(raw)
  const id=(await sha256(api,cfg.url+'|'+cfg.username+'|'+folder)).slice(0,16)
  return {namespace:'lx:'+id,lists}
}
