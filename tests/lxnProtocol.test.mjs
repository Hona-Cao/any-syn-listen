import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  parseLXFile, remoteHash, remoteLists, lxToAnySong,
  anyToLxSong, lxLookup, localHash, remoteLogicalHash, managedListInfo, sha256,
} from '../packages/shared/app/modules/sync/lxn/format.ts'

const song = (id = '123') => ({
  id, name: 'Song ' + id, singer: 'Artist', source: 'wy', interval: '03:05',
  meta: { songId: id, albumName: 'Album', qualitys: [{ type: '128k', size: '3M' }],
    _qualitys: { '128k': { size: '3M' } }, unusualLXField: 'keep-me' },
})
const fixture = () => ({
  version: '2', lastModified: 1720000000000,
  data: { defaultList: [song()], loveList: [], tempList: [song('temp')],
    userList: [{ id: 'my-list', name: 'My List', source: 'wy',
      locationUpdateTime: 0, unknownListProperty: 'preserve', list: [song('456')] }],
    customAndroidField: 'untouched' },
  playHistory: [{ id: 'history-1' }], downloadTasks: [{ id: 'download-1' }],
  unknownTopLevel: 'untouched',
})

test('valid LX-N v2 is recognized, including user playlists', () => {
  const file = parseLXFile(JSON.stringify(fixture()))
  assert.deepEqual(remoteLists(file).map(x => x.key), ['default','love','user:my-list'])
  assert.equal(file.playHistory[0].id, 'history-1')
})

test('unsupported version, invalid timestamp, duplicate songs and corrupted shape are rejected', () => {
  for (const invalid of [
    { ...fixture(), version: '3' },
    { ...fixture(), lastModified: NaN },
    { ...fixture(), data: { ...fixture().data, defaultList: [song(), song()] } },
    { ...fixture(), data: { ...fixture().data, userList: null } },
    { ...fixture(), data: { ...fixture().data, loveList: [{ id:'a' }] } },
  ]) assert.throws(() => parseLXFile(JSON.stringify(invalid)))
})

test('unchanged LX-N songs round-trip without losing source-specific properties', () => {
  const original = parseLXFile(JSON.stringify(fixture()))
  const lookup = lxLookup(original)
  const mapped = lxToAnySong(song())
  const restored = anyToLxSong(mapped, lookup)
  assert.deepEqual(restored, song())
  assert.equal(restored.meta.unusualLXField, 'keep-me')
})

test('remote checksum covers playlists but not playback history or downloads', () => {
  const old = fixture()
  const next = { ...fixture(), playHistory: [{ id: 'different' }], downloadTasks: [] }
  assert.equal(remoteHash(old), remoteHash(next))
  next.data.loveList.push(song('changed'))
  assert.notEqual(remoteHash(old), remoteHash(next))
})

test('hash stability and LX-N binding', () => {
  const item = managedListInfo('user:my-list', 'My List')
  assert.equal(item.type, 'general')
  assert.equal(item.meta.lxnKey, 'user:my-list')
  assert.equal(sha256('x').length, 64)
  const mirror = { key:'user:my-list', id:item.id, name:item.name, info:item,
    songs:[lxToAnySong(song())], newlyLinked:false }
  assert.equal(localHash([mirror]), localHash([mirror]))
})

const makeMirror = (list) => ({
  key: list.key,
  name: 'LX-N · ' + list.name,
  id: 'local-' + list.key,
  info: managedListInfo(list.key, list.name),
  songs: list.songs.map(lxToAnySong),
  newlyLinked: false,
})

test('same playlists from two devices compare identical despite old baselines', () => {
  const file = parseLXFile(JSON.stringify(fixture()))
  const mirrored = remoteLists(file).map(makeMirror)
  assert.equal(localHash(mirrored), remoteLogicalHash(file))
  assert.equal(localHash([...mirrored].reverse()), remoteLogicalHash(file))
})

test('remote timestamp/quality-cache changes alone should not count as a logical conflict', () => {
  const old = parseLXFile(JSON.stringify(fixture()))
  const updated = parseLXFile(JSON.stringify(fixture()))
  updated.lastModified += 1000
  updated.data.userList[0].locationUpdateTime += 200
  updated.data.defaultList[0].meta.unusualLXField = 'metadata changed'
  assert.notEqual(remoteHash(old), remoteHash(updated))
  assert.equal(remoteLogicalHash(old), remoteLogicalHash(updated))
})

test('real added and deleted tracks still change the logical playlist checksum', () => {
  const old = parseLXFile(JSON.stringify(fixture()))
  const updated = parseLXFile(JSON.stringify(fixture()))
  updated.data.userList[0].list.push(song('789'))
  assert.notEqual(remoteLogicalHash(old), remoteLogicalHash(updated))
  const local = remoteLists(old).map(makeMirror)
  local[2].songs.pop()
  assert.notEqual(localHash(local), remoteLogicalHash(old))
})

test('LX-N compatibility sync does not create persistent backup copies', () => {
  const source = readFileSync(new URL('../packages/shared/app/modules/sync/lxn/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /(?:writeFile|mkdirSync|backupDir|backupPath|backupConflict|lxn-conflict-backups)/)
  assert.match(source, /await client\.putData\(path, content\)/)
  assert.match(source, /const check = await readRemote\(client, path\)/)
})

test('latest-only test client disables local automatic SQLite backups', () => {
  const worker = readFileSync(new URL('../packages/desktop/src/worker/dbService.ts', import.meta.url), 'utf8')
  const db = readFileSync(new URL('../packages/shared/app/modules/worker/dbService/db.ts', import.meta.url), 'utf8')
  const backups = readFileSync(new URL('../packages/shared/app/modules/worker/dbService/backupTask/index.ts', import.meta.url), 'utf8')
  assert.match(worker, /appState\.appSetting\['backup\.backupPath'\],\s*false/)
  assert.doesNotMatch(worker, /workers\.dbService\.backupDB\(/)
  assert.match(db, /configureAutomaticBackups\(automaticBackupsEnabled\)/)
  assert.match(backups, /if \(!automaticBackupsEnabled \|\| currentBackupTask\) return false/)
  assert.match(backups, /if \(!automaticBackupsEnabled\) return/)
  const desktopStore = readFileSync(new URL('../packages/desktop/src/shared/store.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(desktopStore, /renameSync\(/)
})

test('latest-only LX-N mode prevents native WebDAV snapshot creation', () => {
  for (const p of [
    '../packages/desktop/src/modules/sync/index.ts',
    '../packages/web-server/src/app/modules/sync/index.ts',
  ]) {
    const source = readFileSync(new URL(p, import.meta.url), 'utf8')
    assert.match(source, /disableNativeWebDAVWhenLXActive/)
    assert.match(source, /'sync\.webdav\.enable': false/)
    assert.match(source, /'sync\.webdav\.syncEnable\.list': false/)
    assert.match(source, /'sync\.webdav\.syncEnable\.dislike': false/)
    assert.match(source, /appState\.appSetting\['sync\.webdav\.enable'\] && !appState\.appSetting\['sync\.lxn\.enable'\]/)
  }
})
