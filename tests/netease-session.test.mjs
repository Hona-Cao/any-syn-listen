import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readCookiePairs, mergeSetCookies, getNeteaseAccountId, refreshNeteaseCookie, requestNetease } from '../packages/shared/app/modules/sync/external/neteaseSession.ts'

test('parse Cookie values and preserve equals signs', () => {
  const p = readCookiePairs('MUSIC_U=alpha=123; __csrf=a; broken; S_INFO=encoded%2Btoken')
  assert.equal(p.get('MUSIC_U'), 'alpha=123')
  assert.equal(p.get('S_INFO'), 'encoded%2Btoken')
  assert.equal(p.has('broken'), false)
})

test('merge HttpOnly refresh cookies and delete expired tokens', () => {
  const merged = mergeSetCookies('MUSIC_U=old; __csrf=original; custom=x', [
    'MUSIC_U=new; Path=/; HttpOnly; Secure',
    '__csrf=fresh; Path=/; Secure',
    'custom=; Max-Age=0; Path=/',
    'other=z; Expires=Fri, 31 Dec 2032 23:59:59 GMT; Secure',
  ])
  const p = readCookiePairs(merged)
  assert.equal(p.get('MUSIC_U'), 'new')
  assert.equal(p.get('__csrf'), 'fresh')
  assert.equal(p.get('other'), 'z')
  assert.equal(p.has('custom'), false)
})

test('deny arbitrary API URLs and missing MUSIC_U', async () => {
  await assert.rejects(requestNetease('https://bad.example/', 'MUSIC_U=x', {}), /Invalid/)
  await assert.rejects(getNeteaseAccountId('a=b'), /not authenticated/)
})

test('refresh validates session and persists new Set-Cookie fields', async (t) => {
  let count = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    count++
    assert.equal(init.method, 'POST')
    if (url.endsWith('login/token/refresh')) {
      const headers = new Headers()
      headers.append('Set-Cookie', 'MUSIC_U=new; HttpOnly; Secure; Path=/')
      headers.append('Set-Cookie', '__csrf=fresh; Path=/')
      return new Response(JSON.stringify({ code: 200 }), { status: 200, headers })
    }
    assert.ok(url.endsWith('nuser/account/get'))
    assert.match(init.headers.Cookie, /MUSIC_U=new/)
    return new Response(JSON.stringify({ code: 200, account: { id: 42 } }), { status: 200 })
  })
  const result = await refreshNeteaseCookie('MUSIC_U=old; __csrf=old')
  assert.equal(readCookiePairs(result).get('MUSIC_U'), 'new')
  assert.equal(readCookiePairs(result).get('__csrf'), 'fresh')
  assert.equal(count, 2)
})

test('failed refresh does not silently authenticate', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ code: 301 }), { status: 200 }))
  await assert.rejects(refreshNeteaseCookie('MUSIC_U=old'), /301/)
})
