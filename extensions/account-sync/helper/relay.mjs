import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto'
const hash = (value) => createHash('sha256').update(value).digest('hex')
const rid = () => randomBytes(16).toString('hex')
export class Relay {
  constructor(saved = {}) {
    this.clients = saved.clients ?? {}; this.queue = saved.queue ?? []
    this.catalog = new Map(); this.sources = {}; this.pairCode = ''; this.pairExpiry = 0; this.failedPairings = 0
  }
  pairing(now = Date.now()) { this.pairCode = String(randomInt(10000000,100000000)); this.pairExpiry = now + 180000; this.failedPairings = 0; return { code:this.pairCode,expiresAt:this.pairExpiry } }
  pair(code, now = Date.now()) {
    if (this.failedPairings >= 5 || !this.pairCode || now > this.pairExpiry || String(code) !== this.pairCode) { this.failedPairings++; throw new Error('连接码无效或已过期') }
    this.pairCode = ''; const token = rid()+rid(); const clientId=rid()
    this.clients[clientId] = { tokenHash:hash(token), label:'AnyListen', lists:[],archives:[],lastSeen:0 }
    return {token,clientId}
  }
  authenticate(header) {
    const raw = String(header ?? '')
    if (!/^Bearer [a-f0-9]{64}$/.test(raw)) return null
    const candidate = Buffer.from(hash(raw.slice(7)))
    return Object.entries(this.clients).find(([,c]) => c.tokenHash && timingSafeEqual(candidate,Buffer.from(c.tokenHash)))?.[0] ?? null
  }
  publish(source, entries) {
    for (const entry of entries) {
      if (!entry.marker || !Array.isArray(entry.songs)) throw new Error('Invalid playlist snapshot')
      const revision = hash(JSON.stringify([entry.name,entry.songs]))
      this.catalog.set(entry.marker, {...entry,source,revision,updatedAt:Date.now()})
    }
  }
  addOperation(clientId, kind, data={}) {
    const client=this.clients[clientId];if(!client)throw new Error('播放器尚未连接')
    if (!['archive','delete','restore','resume'].includes(kind))throw new Error('不支持的操作')
    let ids=[...new Set(data.ids ?? [])]
    if(kind==='archive'||kind==='delete'){
      if(!ids.length||ids.length>1000)throw new Error('请选择歌单')
      const known=new Set(client.lists.map(x=>x.id))
      if(ids.some(id=>!known.has(id)||['love','default','last_played'].includes(id)))throw new Error('包含不能删除的歌单')
      if(client.lists.some(x=>ids.includes(x.parentId)&&!ids.includes(x.id)))throw new Error('请同时选择子歌单')
    }
    const op={id:rid(),clientId,kind,ids,archiveId:data.archiveId,markers:data.markers,at:Date.now(),status:'pending'}
    this.queue.push(op); return op.id
  }
  poll(clientId,payload) {
    const client=this.clients[clientId];if(!client)throw new Error('Unauthorized')
    if(!Array.isArray(payload.lists)||payload.lists.length>10000)throw new Error('Invalid playlist index')
    client.lists=payload.lists.filter(x=>typeof x.id==='string'&&typeof x.name==='string'&&!['love','default','last_played'].includes(x.id))
    client.archives=Array.isArray(payload.archives)?payload.archives:[]
    client.ignored=Array.isArray(payload.ignored)?payload.ignored:[]
    client.lastSeen=Date.now()
    for(const op of this.queue){const result=payload.results?.[op.id];if(op.clientId===clientId&&op.status==='pending'&&result){op.status=result.ok?'done':'failed';op.result=result}}
    const operations=this.queue.filter(x=>x.clientId===clientId&&x.status==='pending')
    const revisions=payload.revisions??{}
    return {operations,catalog:[...this.catalog.values()].filter(x=>!client.ignored.includes(x.marker)&&!(x.aliases??[]).some(m=>client.ignored.includes(m))&&revisions[x.marker]!==x.revision)}
  }
  saved() { return {clients:this.clients,queue:this.queue.slice(-1000)} }
  view() {return {clients:Object.entries(this.clients).map(([id,c])=>({id,label:c.label,lists:c.lists,archives:c.archives,ignored:c.ignored??[],online:Date.now()-c.lastSeen<20000})),queue:this.queue.slice(-20).map(({id,clientId,kind,status,result})=>({id,clientId,kind,status,result})),sourceCount:this.catalog.size}}
}
