const BLOCKED = new Set(['default', 'love', 'last_played'])
const clone = (x) => JSON.parse(JSON.stringify(x))
const markerOf = (item) => typeof item?.meta?.externalMirror === 'string' ? item.meta.externalMirror : null
export function selectableLists(all) {
  return (all?.userList ?? []).filter((x) => !BLOCKED.has(x.id) && (x.type === 'general' || x.type === 'online'))
}
export function sanitizeCatalog(raw) {
  if (!raw || typeof raw.marker !== 'string' || !raw.marker || typeof raw.name !== 'string' || !Array.isArray(raw.songs)) throw new Error('Invalid source playlist')
  const ids = new Set()
  const songs = []
  for (const song of raw.songs) {
    if (!song || typeof song.id !== 'string' || !song.id || typeof song.name !== 'string' || !song.meta || song.isLocal !== false || typeof song.meta.source !== 'string') throw new Error('Incomplete source songs')
    if (!ids.has(song.id)) { ids.add(song.id); songs.push(song) }
  }
  return { ...raw, songs }
}
const summary = (songs) => JSON.stringify(songs.map((x) => [x.id, x.name, x.singer, x.interval, x.meta?.musicId, x.meta?.source, x.meta?.albumName, x.meta?.picUrl, x.meta?.qualitys]))
export class SyncEngine {
  constructor(api, transport) { this.api = api; this.transport = transport; this.state = { version: 1, ignored: {}, archives: [], operations: {}, revisions: {} }; this.tail = Promise.resolve(); this.mutating = false; this.index = new Map() }
  async load() {
    if (await this.api.storage.fileExists('state.json')) {
      const saved = JSON.parse(await this.api.storage.readFile('state.json', 'utf-8'))
      if (saved.version !== 1 || !saved.ignored || !Array.isArray(saved.archives)) throw new Error('Unsupported extension state')
      this.state = { ...this.state, ...saved }
    }
    await this.refreshIndex()
  }
  async save() { await this.api.storage.writeFile('state.json', JSON.stringify(this.state)) }
  serial(task) { const result = this.tail.then(task, task); this.tail = result.catch(() => {}); return result }
  async refreshIndex() {
    const lists = selectableLists(await this.api.musicList.getAllUserLists())
    this.index = new Map(lists.map((x) => [x.id, clone(x)]))
    return lists
  }
  async onExternalAction(action) {
    if (action.action !== 'list_remove') return
    const markers = action.data.map((id) => markerOf(this.index.get(id))).filter(Boolean)
    if (!markers.length) return
    return this.serial(async () => { for (const marker of markers) this.state.ignored[marker] = true; await this.save() })
  }
  async archive(op) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(op.id) || !Array.isArray(op.ids) || !op.ids.length) throw new Error('Invalid operation')
    if (op.ids.some((id) => BLOCKED.has(id))) throw new Error('系统歌单不能删除')
    await this.refreshIndex()
    const all = (await this.api.musicList.getAllUserLists()).userList ?? []
    const ids = [...new Set(op.ids)]
    if (all.some((x) => ids.includes(x.id) && !this.index.has(x.id))) throw new Error('远程目录和本地文件夹请在播放器中管理')
    const chosen = ids.map((id) => this.index.get(id)).filter(Boolean)
    if (all.some((x) => ids.includes(x.parentId) && !ids.includes(x.id))) throw new Error('请同时选择该歌单的子歌单')
    const path = 'archives/' + op.id + '.json'
    if (!(await this.api.storage.fileExists(path))) {
      const entries = []
      for (const info of chosen) entries.push({ info, songs: await this.api.musicList.getListMusics(info.id) })
      await this.api.storage.writeFile(path, JSON.stringify({ version: 1, kind: op.kind, entries }))
    }
    for (const info of chosen) { const m = markerOf(info); if (m) this.state.ignored[m] = true }
    if (!this.state.archives.some((x) => x.id === op.id)) this.state.archives.push({ id: op.id, path, kind: op.kind, count: chosen.length, names: chosen.map((x) => x.name), at: Date.now() })
    await this.save() // Persist suppressions and snapshot before destructive action.
    if (chosen.length) await this.api.musicList.listAction({ action: 'list_remove', data: chosen.map((x) => x.id) })
    return { count: chosen.length }
  }
  async restore(op) {
    const archive = this.state.archives.find((x) => x.id === op.archiveId)
    if (!archive) throw new Error('归档不存在')
    const data = JSON.parse(await this.api.storage.readFile(archive.path, 'utf-8'))
    const existing = new Set((await this.refreshIndex()).map((x) => x.id))
    let count = 0
    for (const entry of data.entries) {
      if (BLOCKED.has(entry.info.id) || existing.has(entry.info.id)) continue
      const info = clone(entry.info)
      info.type = 'general'
      if (markerOf(info)) { info.meta.archivedSource = markerOf(info); delete info.meta.externalMirror }
      info.meta.externalSyncPaused = true
      if (!existing.has(info.parentId)) info.parentId = null
      await this.api.musicList.listAction({ action: 'list_create', data: { position: -1, listInfos: [info] } })
      await this.api.musicList.listAction({ action: 'list_music_overwrite', data: { listId: info.id, musicInfos: entry.songs } })
      existing.add(info.id); count++
    }
    archive.restoredAt = Date.now(); await this.save()
    return { count }
  }
  async applyOperation(op) {
    if (this.state.operations[op.id]) return this.state.operations[op.id]
    this.mutating = true
    let result
    try {
      if (op.kind === 'archive' || op.kind === 'delete') result = { ok: true, ...await this.archive(op) }
      else if (op.kind === 'restore') result = { ok: true, ...await this.restore(op) }
      else if (op.kind === 'resume') { for (const marker of op.markers ?? []) { delete this.state.ignored[marker]; delete this.state.revisions[marker] } result = { ok: true } }
      else throw new Error('Unsupported operation')
    } catch (error) { result = { ok: false, error: String(error.message).slice(0,180) } }
    finally { this.mutating = false }
    this.state.operations[op.id] = result
    await this.save()
    return result
  }
  async upsert(raw) {
    const item = sanitizeCatalog(raw)
    if (this.state.ignored[item.marker] || (item.aliases ?? []).some((x) => this.state.ignored[x])) return false
    const all = await this.refreshIndex()
    let current = all.find((x) => markerOf(x) === item.marker || (item.aliases ?? []).includes(markerOf(x)))
    if (current && this.state.ignored[markerOf(current)]) return false
    const now = Date.now()
    if (!current) {
      const digest = await this.api.utils.crypto.sha256(item.marker)
      const id = 'acs_' + digest.slice(0, 28)
      if (this.index.has(id)) throw new Error('歌单 ID 冲突')
      current = { id, parentId: null, type: 'general', name: item.name, meta: { externalMirror: item.marker, createTime: now, updateTime: now, posTime: 0, playCount: 0, songCount: item.songs.length, pic: '', desc: '' } }
      await this.api.musicList.listAction({ action: 'list_create', data: { position: -1, listInfos: [current] } })
    } else if (current.name !== item.name || markerOf(current) !== item.marker) {
      current = { ...current, name: item.name, meta: { ...current.meta, externalMirror: item.marker, updateTime: now } }
      await this.api.musicList.listAction({ action: 'list_update', data: { lists: [current] } })
    }
    const old = await this.api.musicList.getListMusics(current.id)
    if (summary(old) !== summary(item.songs)) await this.api.musicList.listAction({ action: 'list_music_overwrite', data: { listId: current.id, musicInfos: item.songs } })
    this.state.revisions[item.marker] = item.revision
    return true
  }
  async cycle() {
    return this.serial(async () => {
      const lists = await this.refreshIndex()
      const response = await this.transport({ lists: lists.map((x) => ({ id: x.id, name: x.name, type: x.type, parentId: x.parentId, marker: markerOf(x), songCount: x.meta.songCount })), archives: this.state.archives, ignored: Object.keys(this.state.ignored), results: this.state.operations, revisions: this.state.revisions })
      for (const op of response.operations ?? []) await this.applyOperation(op)
      for (const list of response.catalog ?? []) {
        try { this.mutating = true; await this.upsert(list) }
        catch { this.api.logcat.warn('某个歌单同步未完成，保留本地数据') }
        finally { this.mutating = false }
      }
      await this.save(); await this.refreshIndex()
    })
  }
}
