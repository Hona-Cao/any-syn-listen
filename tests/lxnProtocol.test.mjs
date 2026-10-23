import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseLXFile, remoteHash, remoteLists, lxToAnySong,
  anyToLxSong, lxLookup, localHash, managedListInfo, sha256,
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
