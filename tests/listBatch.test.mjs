import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectNewMusic, isProtectedLXMirror, canBatchEditList, buildCopyChunks } from '../packages/view-main/src/components/layout/Aside/MyList/batchUtils.ts'

const music = (id) => ({ id, name: 'Song ' + id, singer: '', meta: { source: 'wy' }, isLocal: false })
const list = (id, type = 'general', lxnKey) => ({
  id, name: 'List ' + id, type, meta: { songCount: 1, lxnKey },
})

test('batch copy merges multiple source lists and does not re-add existing songs', () => {
  const existing = [music('001'), music('003')]
  const incoming = [music('003'), music('004'), music('002'), music('004'), music('001'), music('005')]
  assert.deepEqual(collectNewMusic(existing, incoming).map(x => x.id), ['004', '002', '005'])
  assert.deepEqual(existing.map(x=>x.id), ['001','003'])
  assert.deepEqual(incoming.map(x=>x.id), ['003','004','002','004','001','005'])
})

test('batch deletion and rename protect system and LX-N mandatory mirrors', () => {
  assert.equal(canBatchEditList(list('custom')), true)
  assert.equal(canBatchEditList(list('lxn-user', 'general', 'user:123')), true)
  assert.equal(canBatchEditList(list('lxn-love', 'general', 'love')), false)
  assert.equal(canBatchEditList(list('lxn-default', 'general', 'default')), false)
  assert.equal(canBatchEditList(list('default', 'default')), false)
  assert.equal(canBatchEditList(list('remote', 'remote')), false)
  assert.equal(canBatchEditList(list('local', 'local')), false)
  assert.equal(isProtectedLXMirror(list('love-mirror', 'general', 'love')), true)
})

test('copying many songs preserves their order when app setting inserts at top', () => {
  const input = [1,2,3,4,5,6,7]
  assert.deepEqual(buildCopyChunks(input, 3, 'bottom'), [[1,2,3],[4,5,6],[7]])
  assert.deepEqual(buildCopyChunks(input, 3, 'top'), [[7],[4,5,6],[1,2,3]])
  assert.deepEqual(input, [1,2,3,4,5,6,7])
  assert.throws(() => buildCopyChunks(input, 0, 'bottom'))
})
