import assert from 'node:assert/strict'
import { test } from 'node:test'

import { convertQQSong, readQQMusicPlaylists } from '../packages/shared/app/modules/sync/external/qqMusic.ts'
import {
  convertKugouSong, createKugouLoginQR, checkKugouLoginQR, readKugouPlaylists,
} from '../packages/shared/app/modules/sync/external/kugouMusic.ts'

test('QQ song maps to AnyListen online-resource IDs', () => {
  const item = convertQQSong({
    id: 123,
    mid: '0021abc',
    title: '测试歌',
    singer: [{ name: '歌手 A' }],
    interval: 125,
    album: { name: '专辑 A', mid: 'album1' },
    file: { media_mid: 'media1', size_320mp3: 2097152 },
  })
  assert.equal(item.id, 'tx_0021abc')
  assert.equal(item.meta.musicId, '0021abc')
  assert.equal(item.interval, '02:05')
  assert.equal(item.meta.qualitys['320k'].sizeStr, '2.00 MB')
})

test('QQ user playlist reader paginates and never mutates remote data', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined })
    if (String(url).includes('fcg_get_profile_homepage')) {
      return new Response(JSON.stringify({ data: { creator: { encrypt_uin: '' } } }), { status: 200 })
    }
    const body = JSON.parse(init.body)
    const key = Object.keys(body).filter((k) => k !== 'comm')[0]
    if (key === 'music.musicasset.PlaylistBaseRead') {
      return new Response(JSON.stringify({
        code: 0, [key]: { code: 0, data: { v_playlist: [{ tid: 1234, dirId: 0, dirName: '我创建的歌单', songNum: 1 }] } },
      }), { status: 200 })
    }
    return new Response(JSON.stringify({
      code: 0, [key]: { code: 0, data: {
        total_song_num: 1,
        songlist: [{ id: 2, mid: '001abc', title: '一首歌', singer: [{ name: '作者' }] }],
      } },
    }), { status: 200 })
  })
  const result = await readQQMusicPlaylists({ musicId: '12345678', musicKey: 'W_Xexample' })
  assert.equal(result[0].key, 'playlist:1234')
  assert.equal(result[0].list[0].id, 'tx_001abc')
  assert.equal(requests.filter((r) => r.body).length, 2)
  assert.ok(requests.filter((r) => r.body).every((r) => JSON.stringify(r.body).includes('tmeLoginType')))
})

test('QQ incomplete song response rejects rather than erases a mirrored playlist', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body)
    const key = Object.keys(body).filter((k) => k !== 'comm')[0]
    const data = key.includes('PlaylistBaseRead')
      ? { v_playlist: [{ tid: 1234, dirId: 0, dirName: '歌单' }] }
      : { total_song_num: 2, songlist: [{ name: '没有 mid 的歌曲' }] }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }), { status: 200 })
  })
  await assert.rejects(readQQMusicPlaylists({ musicId: '12345678', musicKey: 'valid' }), /unrecognized/)
})

test('Kugou hashes map to AnyListen KG identifiers', () => {
  const hash = 'A'.repeat(32)
  const song = convertKugouSong({ hash, audio_id: 456, songname: '酷狗歌曲', author_name: '某歌手', timelength: 180000 })
  assert.equal(song.id, 'kg_456_' + hash)
  assert.equal(song.meta.hash, hash)
  assert.equal(song.interval, '03:00')
  assert.equal(song.meta.qualitys['128k'].hash, hash)
})

test('Kugou account read-only mirror fetches playlists and all track pages', async (t) => {
  const account = { userId: '12345', token: 'secure_token', mid: 'a'.repeat(32) }
  const requested = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const u = new URL(url)
    const body = JSON.parse(init.body)
    requested.push({ route: u.pathname, sig: u.searchParams.get('signature'), body })
    if (u.pathname.includes('get_all_list')) {
      return new Response(JSON.stringify({ status: 1, data: { total: 1, info: [{ listid: 33, name: '我收藏的歌单', count: 1 }] } }), { status: 200 })
    }
    return new Response(JSON.stringify({ status: 1, data: {
      count: 1, info: [{ hash: 'B'.repeat(32), audio_id: 555, songname: '云端歌曲' }],
    } }), { status: 200 })
  })
  const lists = await readKugouPlaylists(account)
  assert.equal(lists[0].key, 'playlist:33')
  assert.equal(lists[0].list[0].meta.musicId, '555')
  assert.deepEqual(requested.map((x) => x.route), ['/v7/get_all_list', '/v4/get_list_all_file_v3'])
  assert.ok(requested.every((x) => /^[a-f0-9]{32}$/i.test(x.sig)))
})

test('Kugou QR flow requires real signed response then accepts authorization', async (t) => {
  let count = 0
  t.mock.method(globalThis, 'fetch', async (url) => {
    count++
    const u = new URL(url)
    assert.equal(u.hostname, 'login-user.kugou.com')
    const data = u.pathname === '/v2/qrcode'
      ? { qrcode: 'key_for_test_12345', qrcode_img: 'A'.repeat(256) }
      : { status: 4, userid: '7654321', token: 'granted' }
    return new Response(JSON.stringify({ status: 1, data }), { status: 200 })
  })
  const qr = await createKugouLoginQR()
  assert.ok(qr.url.startsWith('https://h5.kugou.com/'))
  const result = await checkKugouLoginQR(qr)
  assert.equal(result.status, 'connected')
  assert.equal(result.account.userId, '7654321')
  assert.equal(count, 2)
})


test('Kugou hash-only cloud songs obtain metadata before mirroring', async (t) => {
  const requested = []
  const hash = 'C'.repeat(32)
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const target = new URL(url)
    requested.push(target.pathname)
    if (target.pathname === '/v7/get_all_list') {
      return new Response(JSON.stringify({
        status: 1, data: { total: 1, info: [{ listid: 123, name: '测试云歌单', count: 1 }] },
      }), { status: 200 })
    }
    if (target.pathname === '/v4/get_list_all_file_v3') {
      return new Response(JSON.stringify({
        status: 1, data: { count: 1, info: [{ hash }] },
      }), { status: 200 })
    }
    assert.equal(target.pathname, '/v2/album_audio/audio')
    const body = JSON.parse(init.body)
    assert.equal(body.data[0].hash, hash)
    return new Response(JSON.stringify({
      error_code: 0, data: [[{
        songname: '云端元数据歌曲',
        author_name: '歌手 A',
        audio_info: { audio_id: 8888, hash, timelength: '142000' },
        album_info: { album_id: 12, album_name: '元数据专辑' },
      }]],
    }), { status: 200 })
  })
  const results = await readKugouPlaylists({ userId: '1234', token: 'secret', mid: 'a'.repeat(32) })
  assert.equal(results[0].list[0].id, 'kg_8888_' + hash)
  assert.equal(results[0].list[0].name, '云端元数据歌曲')
  assert.equal(results[0].list[0].interval, '02:22')
  assert.deepEqual(requested, ['/v7/get_all_list', '/v4/get_list_all_file_v3', '/v2/album_audio/audio'])
})

test('Kugou malformed metadata prevents destructive updates', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const endpoint = new URL(url).pathname
    if (endpoint === '/v7/get_all_list') {
      return new Response(JSON.stringify({ status: 1, data: { total: 1, info: [{ listid: 3, name: '目录', count: 1 }] } }), { status: 200 })
    }
    if (endpoint === '/v4/get_list_all_file_v3') {
      return new Response(JSON.stringify({ status: 1, data: { count: 1, info: [{ hash: 'D'.repeat(32) }] } }), { status: 200 })
    }
    return new Response(JSON.stringify({ error_code: 0, data: [] }), { status: 200 })
  })
  await assert.rejects(
    readKugouPlaylists({ userId: '1234', token: 'secret', mid: 'a'.repeat(32) }),
    /元数据返回不完整/
  )
})
