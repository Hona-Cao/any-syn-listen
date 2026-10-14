import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readNeteaseAccountPlaylists } from '../packages/shared/app/modules/sync/external/netease.ts'

const track = { id: 222, name: '可识别歌曲', dt: 125000, ar: [{ name: '作者 A' }], al: { id: 1, name: '专辑 A' } }

test('NetEase fetches account playlists and daily songs as separate, stable mirrors', async (t) => {
  const requested = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const route = new URL(url).pathname.replace('/weapi/', '')
    requested.push(route)
    assert.match(init.headers.Cookie, /MUSIC_U=fake-test-cookie/)
    const result = route === 'nuser/account/get'
      ? { code: 200, account: { id: 1000 } }
      : route === 'user/playlist'
        ? { code: 200, playlist: [{ id: 42, name: '我的网易歌单' }] }
        : route === 'v3/playlist/detail'
          ? { code: 200, playlist: { trackCount: 1, trackIds: [{ id: 222 }] } }
          : route === 'v3/song/detail'
            ? { code: 200, songs: [track] }
            : { code: 200, data: { dailySongs: [{ ...track, id: 223, name: '每日好歌' }] } }
    return new Response(JSON.stringify(result), { status: 200 })
  })
  const result = await readNeteaseAccountPlaylists('MUSIC_U=fake-test-cookie')
  assert.equal(result.uid, 1000)
  assert.deepEqual(result.lists.map((x) => x.key), ['playlist:42', 'daily'])
  assert.equal(result.lists[0].list[0].meta.musicId, '222')
  assert.equal(result.lists[1].list[0].name, '每日好歌')
  assert.equal(result.lists[0].list[0].interval, '02:05')
  assert.deepEqual(requested, [
    'nuser/account/get', 'user/playlist', 'v3/playlist/detail',
    'v3/song/detail', 'song/like/get', 'v3/discovery/recommend/songs',
  ])
})

test('NetEase rejects truncated songlists so existing mirrors remain untouched', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(url).pathname
    const body = path.endsWith('nuser/account/get')
      ? { code: 200, account: { id: 1000 } }
      : path.endsWith('user/playlist')
        ? { code: 200, playlist: [{ id: 42, name: '歌曲丢失' }] }
        : { code: 200, playlist: { trackCount: 5, trackIds: [{ id: 222 }] } }
    return new Response(JSON.stringify(body), { status: 200 })
  })
  await assert.rejects(readNeteaseAccountPlaylists('MUSIC_U=fake-test-cookie'), /metadata incomplete/)
})
