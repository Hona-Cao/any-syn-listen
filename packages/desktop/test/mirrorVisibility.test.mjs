import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseHiddenMirrorMarkers, withHiddenMirrorMarkers,
} from '../../view-main/src/components/layout/Aside/MyList/mirrorVisibility.ts'

test('deleted account mirror stays hidden after a native snapshot restores its row', () => {
  const marker = 'qqmusic:1234:playlist:89'
  const localRegistry = withHiddenMirrorMarkers('[]', [marker], true)
  const nativeSnapshotRow = { meta: { externalMirror: marker, externalMirrorHidden: false } }
  // The local-only registry is independent from the DB meta restored by native WebDAV.
  assert.equal(parseHiddenMirrorMarkers(localRegistry).has(nativeSnapshotRow.meta.externalMirror), true)
})
test('deleted LX mirror remains hidden even if an older native snapshot re-adds it', () => {
  const marker = 'lx-webdav:/LX_Music:user:test-old'
  const registry = withHiddenMirrorMarkers('[]', [marker], true)
  assert.equal(parseHiddenMirrorMarkers(registry).has(marker), true)
  assert.equal(parseHiddenMirrorMarkers(withHiddenMirrorMarkers(registry, [marker], false)).has(marker), false)
})
test('multiple removals preserve existing unrelated markers', () => {
  const first = withHiddenMirrorMarkers('[]', ['netease:1:playlist:42'], true)
  const second = withHiddenMirrorMarkers(first, ['qqmusic:2:daily', 'netease:1:playlist:42'], true)
  assert.deepEqual([...parseHiddenMirrorMarkers(second)].sort(), ['netease:1:playlist:42','qqmusic:2:daily'])
})
test('malformed legacy preferences and unrelated IDs never hide native lists', () => {
  assert.equal(parseHiddenMirrorMarkers('{bad').size, 0)
  assert.equal(parseHiddenMirrorMarkers(JSON.stringify(['native:list1','lx-webdav:/LX_Music:user:ok'])).size, 1)
  assert.equal(withHiddenMirrorMarkers('[]', ['native:list1'], true), '[]')
})
