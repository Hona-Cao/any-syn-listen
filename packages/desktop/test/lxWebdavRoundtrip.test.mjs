import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseLXDocument, materializeLXDocument, removeLXUserListsFromDocument, commitLXUserDeletion, signatureOfLXLocalLists, datedLXRecommendations, planLXDirection,
} from '../../shared/app/modules/sync/external/lxLibrary.ts'

const source = () => ({
  version: '2',
  lastModified: 1000,
  extraField: { preserved: true },
  data: {
    defaultList: [{ id: 'wy_1', name: '试听', singer: '艺人', source: 'wy', meta: { art: 'a', _qualitys: { flac: { size: '4MB' } } } }],
    loveList: [{ id: 'qq_2', name: '收藏', singer: 'B', source: 'qq', meta: { custom: 13 } }],
    tempList: [{ anything: 'keep' }],
    userList: [
      { id: 'old', name: '旧歌单', list: [{ id: 'wy_3', name: '旧歌', source: 'wy', meta: { pic: 'keep' } }], custom: 1 },
      { id: 'new', name: '每日推荐 2026-10-15', list: [{ id: 'wy_4', name: '日推', source: 'wy' }], custom: 2 },
    ],
  },
})
const songs = (a) => a.map(s => ({
  id: s.id, name: s.name, singer: s.singer ?? '', interval: s.interval ?? null,
  isLocal: false, meta: { source: s.source ?? s.id.split('_')[0], ...(s.meta ?? {}) },
}))
const localFrom = (doc) => [
  { key: 'default', name: 'LX N · 试听列表', songs: songs(doc.data.defaultList) },
  { key: 'love', name: 'LX N · 我的收藏', songs: songs(doc.data.loveList) },
  ...doc.data.userList.map(v => ({ key: 'user:' + v.id, name: 'LX N · ' + v.name, songs: songs(v.list) })),
]

test('validates complete file rather than treating corrupt files as delete-all', () => {
  assert.throws(() => parseLXDocument('null'), /invalid/)
  assert.throws(() => parseLXDocument(JSON.stringify({ data: { defaultList: [], loveList: [] } })), /missing/)
  const duplicate = source()
  duplicate.data.userList[1].id = 'old'
  assert.throws(() => parseLXDocument(JSON.stringify(duplicate)), /duplicated/)
  const malformed = source()
  malformed.data.userList[0].list = [null]
  assert.throws(() => parseLXDocument(JSON.stringify(malformed)), /invalid song/)
})
test('unchanged source tracks and unknown document properties survive a roundtrip', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  const next = materializeLXDocument(doc, localFrom(doc), 900)
  assert.deepEqual(next.data, doc.data)
  assert.deepEqual(next.extraField, { preserved: true })
  assert.deepEqual(next.data.defaultList[0].meta, doc.data.defaultList[0].meta)
  assert.equal(next.lastModified, 1001)
})
test('whole-library replacement propagates playlist deletion but preserves raw track fields', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  const local = localFrom(doc).filter(item => item.key !== 'user:old')
  local.find(item => item.key === 'user:new').name = 'LX N · 重命名的推荐'
  const next = materializeLXDocument(doc, local, 2500)
  assert.deepEqual(next.data.userList.map(v => v.id), ['new'])
  assert.equal(next.data.userList[0].name, '重命名的推荐')
  assert.equal(next.data.userList[0].custom, 2)
  assert.deepEqual(next.data.loveList, doc.data.loveList)
  assert.deepEqual(next.data.tempList, doc.data.tempList)
  assert.equal(next.lastModified, 2500)
})
test('refuses deletion of source favorites/listening lists', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  assert.throws(() => materializeLXDocument(doc, localFrom(doc).filter(x => x.key !== 'love'), 10000), /cannot remove/)
})
test('rejects locally unrepresentable tracks before any WebDAV upload', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  doc.data.defaultList.push({ id: 'local_0', name: '手机本地音频', source: 'local' })
  const incompleteMirror = localFrom(doc).filter(x => x.key !== 'user:old')
  // The original LX converter deliberately skips Android-only files.
  incompleteMirror.find(x => x.key === 'default').songs = []
  assert.throws(() => materializeLXDocument(doc, incompleteMirror, 2000), /unsupported source/)
})
test('new online songs can be written while preserving existing track metadata', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  const local = localFrom(doc)
  local.find(x => x.key === 'user:new').songs.push({
    id: 'wy_99', name: '新增', singer: 'Singer', interval: null, isLocal: false,
    meta: { source: 'wy', musicId: '99' },
  })
  const next = materializeLXDocument(doc, local, 2000)
  assert.deepEqual(next.data.userList[1].list[0], doc.data.userList[1].list[0])
  assert.equal(next.data.userList[1].list[1].id, 'wy_99')
  assert.equal(next.data.userList[1].list[1].meta.id, '99')
})
test('checkpoints ignore UI archive state, but react to track edits', () => {
  const local = localFrom(source())
  const first = signatureOfLXLocalLists(local)
  local[0].songs.pop()
  assert.notEqual(signatureOfLXLocalLists(local), first)
})
test('only dated LX daily history older than latest is auto-archived', () => {
  const results = datedLXRecommendations([
    { key: 'user:a', name: 'LX N · 每日推荐 2026-10-13' },
    { key: 'user:b', name: 'LX N · 每日推荐 2026-10-15' },
    { key: 'user:c', name: 'LX N · 每日推荐' },
    { key: 'user:d', name: 'LX N · 每日推荐 2026-13-55' },
    { key: 'user:e', name: 'LX N · 我的每日推荐 2026-10-01' },
  ])
  assert.deepEqual([...results], ['user:a'])
})

test('first-time writable LX sync imports remote; later local edits upload', () => {
  assert.equal(planLXDirection(true, '', 'remote:', 'local-hash'), 'import')
  assert.equal(planLXDirection(true, 'different:older', 'remote:', 'local-hash'), 'import')
  assert.equal(planLXDirection(false, 'remote:older', 'remote:', 'local-hash'), 'import')
  assert.equal(planLXDirection(true, 'remote:old-hash', 'remote:', 'new-hash'), 'write')
  assert.equal(planLXDirection(true, 'remote:same-hash', 'remote:', 'same-hash'), 'import')
})

test('desktop edits to existing songs write back without removing LX-specific metadata', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  const local = localFrom(doc)
  local.find(item => item.key === 'default').songs[0].name = '修改后的曲名'
  local.find(item => item.key === 'default').songs[0].singer = '新歌手'
  local.find(item => item.key === 'user:new').songs[0].name = '重命名的日推曲目'
  const result = materializeLXDocument(doc, local, 5000)
  assert.equal(result.data.defaultList[0].name, '修改后的曲名')
  assert.equal(result.data.defaultList[0].singer, '新歌手')
  assert.deepEqual(result.data.defaultList[0].meta, doc.data.defaultList[0].meta)
  assert.equal(result.data.userList[1].list[0].name, '重命名的日推曲目')
})

test('edits to existing songs survive adding another song to the same list', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  const local = localFrom(doc)
  local.find(item => item.key === 'default').songs[0].name = '改名后的试听'
  local.find(item => item.key === 'default').songs.push({
    id: 'wy_100', name: '新增', singer: 'B', interval: null,
    isLocal: false, meta: { source: 'wy', musicId: '100' },
  })
  const result = materializeLXDocument(doc, local, 5000)
  assert.deepEqual(result.data.defaultList.map(s => s.name), ['改名后的试听', '新增'])
  assert.deepEqual(result.data.defaultList[0].meta, doc.data.defaultList[0].meta)
})

test('unrelated playlist deletion does not remove Android-only listening tracks', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  doc.data.defaultList.push({ id: 'local_001', name: '手机本地音乐', source: 'local', meta: { path: '/android/file.flac' } })
  const local = localFrom(doc)
  // The mirror genuinely does not contain the Android local-only track.
  local.find(item => item.key === 'default').songs.pop()
  const next = materializeLXDocument(doc, local.filter(item => item.key !== 'user:old'), 9000)
  assert.equal(next.data.defaultList.length, 2)
  assert.equal(next.data.defaultList[1].id, 'local_001')
  assert.equal(next.data.defaultList[1].meta.path, '/android/file.flac')
  assert.deepEqual(next.data.userList.map(item => item.id), ['new'])
})

test('invalid remote timestamps are rejected before write-back', () => {
  const doc = source()
  doc.lastModified = '2026-yesterday'
  assert.throws(() => parseLXDocument(JSON.stringify(doc)), /invalid lastModified/)
})
test('deduplicated desktop song mirrors cannot truncate duplicate LX source songs', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  doc.data.loveList.push({ ...doc.data.loveList[0] })
  const local = localFrom(doc)
  local.find(item => item.key === 'love').songs.pop()
  assert.throws(() => materializeLXDocument(doc, local, 5500), /duplicate source song IDs/)
})

test('new desktop LX user playlists receive a stable LX id and roundtrip', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  const local = localFrom(doc)
  local.push({ key: 'user:new-from-desktop', name: 'LX N · 我的新歌单', songs: [] })
  const result = materializeLXDocument(doc, local, 10000)
  assert.deepEqual(result.data.userList.map(item => item.id), ['old', 'new', 'new-from-desktop'])
  assert.deepEqual(result.data.userList.at(-1), { id: 'new-from-desktop', name: '我的新歌单', list: [] })
  assert.equal(parseLXDocument(JSON.stringify(result)).data.userList.length, 3)
})
test('unknown malformed LX mirror keys refuse writeback', () => {
  const doc = parseLXDocument(JSON.stringify(source()))
  assert.throws(() => materializeLXDocument(doc,
    [...localFrom(doc), { key: 'not-an-lx-playlist', name: '非法', songs: [] }], 2000), /invalid user playlist/)
})

test('confirmed LX deletion removes only the selected source playlist', () => {
  const raw = parseLXDocument(JSON.stringify(source()))
  const next = removeLXUserListsFromDocument(raw, ['old'], 5000)
  assert.deepEqual(next.data.userList.map(item => item.id), ['new'])
  assert.deepEqual(next.data.defaultList, raw.data.defaultList)
  assert.deepEqual(next.data.loveList, raw.data.loveList)
  assert.deepEqual(next.data.tempList, raw.data.tempList)
  assert.deepEqual(next.extraField, raw.extraField)
  assert.equal(next.lastModified, 5000)
  assert.equal(raw.data.userList.length, 2)
})

test('LX source deletion is idempotent when phone removed playlist first', () => {
  const raw = parseLXDocument(JSON.stringify(source()))
  const next = removeLXUserListsFromDocument(raw, ['unknown'], 5000)
  assert.deepEqual(next.data, raw.data)
})

test('source delete never accepts empty, system or ambiguous playlist identifiers', () => {
  const raw = parseLXDocument(JSON.stringify(source()))
  for (const ids of [[], [''], ['user:old'], ['\t'], ['old', 'user:love']]) {
    assert.throws(() => removeLXUserListsFromDocument(raw, ids, 5000), /invalid requested/)
  }
})

test('after valid source deletion LX mirror prune receives a complete dataset', async () => {
  const raw = parseLXDocument(JSON.stringify(source()))
  const next = removeLXUserListsFromDocument(raw, ['old'], 5000)
  const valid = parseLXDocument(JSON.stringify(next))
  assert.equal(valid.data.userList.length, 1)
  assert.ok(Array.isArray(valid.data.defaultList))
  assert.ok(Array.isArray(valid.data.loveList))
})

test('LX deletion commits to WebDAV before the local mirror may be removed', async () => {
  let remote = parseLXDocument(JSON.stringify(source()))
  const events = []
  const read = async () => { events.push('remote-read'); return remote }
  const write = async (doc) => { events.push('remote-commit'); remote = doc }
  const local = async () => { events.push('local-reconcile') }
  const confirmed = await commitLXUserDeletion(['old'], read, write, undefined, () => 8000)
  await local(confirmed)
  assert.deepEqual(events, ['remote-read', 'remote-commit', 'remote-read', 'local-reconcile'])
  assert.deepEqual(remote.data.userList.map(v => v.id), ['new'])
})

test('LX network failure never reaches local deletion or reconciliation', async () => {
  const remote = parseLXDocument(JSON.stringify(source()))
  const events = []
  let reconciled = false
  await assert.rejects(commitLXUserDeletion(
    ['old'], async () => remote,
    async () => { events.push('put-failed'); throw new Error('network down') },
    undefined, () => 8000
  ).then(() => { reconciled = true }), /network down/)
  assert.deepEqual(remote.data.userList.map(v => v.id), ['old','new'])
  assert.deepEqual(events, ['put-failed'])
  assert.equal(reconciled, false)
})

test('LX concurrent overwrite is detected by read-back verification', async () => {
  const original = parseLXDocument(JSON.stringify(source()))
  await assert.rejects(
    commitLXUserDeletion(
      ['old'], async () => original,
      async () => { /* a conflicting client writes back the older library */ },
      undefined, () => 8000
    ), /verification failed/
  )
})

test('already-deleted LX source IDs do not rewrite unrelated phone data', async () => {
  const remote = parseLXDocument(JSON.stringify(source()))
  let uploads = 0
  const result = await commitLXUserDeletion(['gone-on-phone'],
    async () => remote,
    async () => { uploads++ },
    undefined, () => 8000)
  assert.equal(result, remote)
  assert.equal(uploads, 0)
})
