import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isAccountMirrorMarker, canManagePlaylist, assertWritablePlaylists,
  isLXDailyArchiveMirror,
} from '../../view-main/src/components/layout/Aside/MyList/mirrorPolicy.ts'

test('NetEase QQ and Kugou account mirrors are immutable', () => {
  for (const marker of ['netease:1:daily','qqmusic:2:playlist:3','kugou:3:love']) {
    assert.equal(isAccountMirrorMarker(marker), true)
    assert.equal(canManagePlaylist(marker), false)
  }
})
test('native and LX-N lists retain owner-managed deletion', () => {
  for (const marker of [null,'','lx-webdav:/LX_Music/:user:date','another:user:sample']) {
    assert.equal(canManagePlaylist(marker), true)
  }
})
test('a mixed selection rejects destructive actions BEFORE mutating any item', () => {
  assert.throws(
    () => assertWritablePlaylists(['lx-webdav:/LX_Music/:user:1','qqmusic:2:playlist:4']),
    /只读歌单/
  )
  assert.doesNotThrow(() => assertWritablePlaylists([null,'lx-webdav:/LX_Music/:user:1']))
})
test('the LX daily filter recognizes only actual source-owned saved user lists', () => {
  assert.equal(isLXDailyArchiveMirror('lx-webdav:/LX_Music/:user:123','LX N · 10_16_daily'),true)
  assert.equal(isLXDailyArchiveMirror('qqmusic:123:daily','LX N · 10_16_daily'),false)
  assert.equal(isLXDailyArchiveMirror('lx-webdav:/LX_Music/:default','LX N · 10_16_daily'),false)
  assert.equal(isLXDailyArchiveMirror('lx-webdav:/LX_Music/:user:123','LX N · 我的日常'),false)
})
