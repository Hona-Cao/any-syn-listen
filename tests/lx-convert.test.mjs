import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLXWebDAVPlaylists, convertLXMusic } from '../packages/shared/app/modules/sync/external/lxConvert.ts'

const wy = (id) => ({
  id: 'wy_' + id,
  name: '测试歌曲',
  singer: '测试歌手',
  interval: '03:21',
  source: 'wy',
  meta: { id, albumName: '测试专辑', _qualitys: { '320k': { size: '10.00 MB' } } },
})
test('reads Android JSON without clobbering AnyListen built-in lists', () => {
  const data = JSON.stringify({
    version: '2',
    lastModified: 1,
    data: {
      defaultList: [wy(100)],
      loveList: [wy(101)],
      tempList: [wy(102)],
      userList: [{ id: 'my_1', name: '我的歌单', list: [wy(103)] }],
    },
  })
  const lists = parseLXWebDAVPlaylists(data)
  assert.deepEqual(lists.map((l) => l.key), ['default', 'love', 'user:my_1'])
  assert.deepEqual(lists.map((l) => l.list.length), [1, 1, 1])
  assert.equal(lists[0].list[0].meta.musicId, '100')
  assert.equal(lists[0].list[0].meta.qualitys['320k'].sizeStr, '10.00 MB')
})
test('ignores Android-local files on desktop', () => {
  assert.equal(convertLXMusic({ id: 'local_123', name: '本地歌', source: 'local', meta: {} }), null)
})
test('rejects malformed WebDAV data rather than erasing playlists', () => {
  assert.throws(() => parseLXWebDAVPlaylists('{}'), /Invalid/)
  assert.throws(() => parseLXWebDAVPlaylists(JSON.stringify({ data: { loveList: [], userList: [] } })), /Unsupported/)
})
