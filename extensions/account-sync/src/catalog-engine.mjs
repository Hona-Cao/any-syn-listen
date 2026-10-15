import {sanitizeCatalog} from './engine.mjs'
const SOURCES={wy:'netease',tx:'qqmusic',kg:'kugou',lx:'lx'}
export class CatalogEngine {
 constructor(api,transport){this.api=api;this.transport=transport;this.catalog=new Map();this.state={version:1,revisions:{},ignored:{},archives:[],operations:{}};this.tail=Promise.resolve()}
 serial(fn){const p=this.tail.then(fn,fn);this.tail=p.catch(()=>{});return p}
 async load(){if(await this.api.storage.fileExists('catalog.json')){const saved=JSON.parse(await this.api.storage.readFile('catalog.json','utf-8'));if(saved.version!==1)throw new Error('扩展缓存版本不匹配');for(const row of saved.catalog||[])this.catalog.set(row.marker,sanitizeCatalog(row));this.state.revisions=saved.revisions||{}}}
 async refreshIndex(){return [...this.catalog.values()].map(x=>({id:x.marker,name:x.name,type:'online',meta:{externalMirror:x.marker,songCount:x.songs.length}}))}
 async onExternalAction(){}
 async cycle(){return this.serial(async()=>{
  const response=await this.transport({lists:[],archives:[],ignored:[],results:{},revisions:this.state.revisions})
  let changed=false
  for(const raw of response.catalog||[]){const row=sanitizeCatalog(raw);this.catalog.set(row.marker,row);this.state.revisions[row.marker]=row.revision;changed=true}
  if(changed)await this.api.storage.writeFile('catalog.json',JSON.stringify({version:1,revisions:this.state.revisions,catalog:[...this.catalog.values()]}))
 })}
}
export function registerCatalogResources(api,controller){
 function items(params){return [...controller.catalogEngine.catalog.values()].filter(x=>x.source===SOURCES[params.source]&&controller.enabled.includes(x.source))}
 function pageOf(rows,params){const page=Math.max(1,Number(params.page)||1),limit=Math.max(1,Math.min(1000,Number(params.limit)||100));return {page,limit,total:rows.length,list:rows.slice((page-1)*limit,page*limit)}}
 function info(row){return {id:row.marker,name:row.name,author:'',img:row.songs[0]?.meta?.picUrl||'',total:row.songs.length,desc:''}}
 api.registerResourceAction({
  songlistSorts:async()=>[{id:'all',name:'我的歌单'}],
  songlistTags:async()=>({tags:[{name:'账号歌单',list:[{id:'all',name:'全部'},{id:'daily',name:'每日推荐'},{id:'love',name:'我喜欢'}]}],hotTags:[{id:'all',name:'全部'},{id:'daily',name:'每日推荐'}]}),
  songlist:async params=>{await controller.tick();let rows=items(params);if(params.tag==='daily')rows=rows.filter(x=>/·每日推荐$/.test(x.name));if(params.tag==='love')rows=rows.filter(x=>/·我喜欢$/.test(x.name));return pageOf(rows.map(info),params)},
  songlistSearch:async params=>{await controller.tick();const q=String(params.keyword||'').toLocaleLowerCase();return pageOf(items(params).filter(x=>x.name.toLocaleLowerCase().includes(q)).map(info),params)},
  songlistDetail:async params=>{await controller.tick();const row=items(params).find(x=>x.marker===params.id);if(!row)throw new Error('请先登录并同步此歌单');return {...pageOf(row.songs,params),info:info(row)}}
 })
}
