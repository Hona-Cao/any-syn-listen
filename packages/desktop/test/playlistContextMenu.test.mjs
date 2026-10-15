import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPlaylistDeleteShortcut, resolvePlaylistContext } from '../../view-main/src/components/layout/Aside/MyList/selection.ts'

const all = [
  { id: 'default', type: 'default', name: '播放列表' },
  { id: 'first', type: 'general', name: '歌单一' },
  { id: 'second', type: 'general', name: '歌单二' },
  { id: 'local', type: 'local', name: '本地文件夹' },
  { id: 'third', type: 'general', name: '歌单三' },
]

test('right-clicking one selected playlist preserves the whole multi-selection', () => {
  const context = resolvePlaylistContext(all[2], ['third', 'first', 'second'], all)
  assert.deepEqual(context.map((item) => item.id), ['first', 'second', 'third'])
})

test('right-clicking an unselected playlist changes target to only that playlist', () => {
  const context = resolvePlaylistContext(all[4], ['first', 'second'], all)
  assert.deepEqual(context.map((item) => item.id), ['third'])
})

test('right-clicking a single selected playlist retains that selection', () => {
  assert.deepEqual(resolvePlaylistContext(all[1], ['first'], all).map((item) => item.id), ['first'])
})

test('right-clicking an ordinary playlist with no selection targets only itself', () => {
  assert.deepEqual(resolvePlaylistContext(all[2], [], all).map((item) => item.id), ['second'])
})

test('built-in and file lists cannot enter a batch context', () => {
  assert.deepEqual(resolvePlaylistContext(all[0], ['first', 'second'], all), [])
  assert.deepEqual(resolvePlaylistContext(all[3], ['first', 'second'], all), [])
  assert.deepEqual(resolvePlaylistContext(null, ['first', 'second'], all), [])
})

test('right-click never targets hidden, removed or stale selected IDs', () => {
  const visible = all.filter((item) => item.id !== 'second')
  const context = resolvePlaylistContext(all[1], ['first', 'second', 'missing'], visible)
  assert.deepEqual(context.map((item) => item.id), ['first'])
})

test('duplicate selected IDs cannot duplicate a destructive operation', () => {
  const context = resolvePlaylistContext(all[1], ['first', 'first', 'second'], all)
  assert.deepEqual(context.map((item) => item.id), ['first', 'second'])
})

test('Delete key triggers batch deletion only for selected playlists while idle', () => {
  assert.equal(isPlaylistDeleteShortcut('Delete', 3, false), true)
  assert.equal(isPlaylistDeleteShortcut('Delete', 1, false), true)
  assert.equal(isPlaylistDeleteShortcut('Delete', 0, false), false)
  assert.equal(isPlaylistDeleteShortcut('Delete', 3, true), false)
  assert.equal(isPlaylistDeleteShortcut('Backspace', 3, false), false)
  assert.equal(isPlaylistDeleteShortcut('Enter', 3, false), false)
})
