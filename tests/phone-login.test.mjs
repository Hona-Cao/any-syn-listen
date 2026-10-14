import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sendNeteasePhoneCode, loginNeteaseWithPhoneCode } from '../packages/shared/app/modules/sync/external/neteasePhone.ts'
import { sendKugouPhoneCode, loginKugouWithPhoneCode } from '../packages/shared/app/modules/sync/external/kugouMusic.ts'

test('OTP endpoints reject invalid numbers without making HTTP calls', async (t) => {
  let n = 0
  t.mock.method(globalThis, 'fetch', async () => { n++; throw new Error('Network must not run') })
  await assert.rejects(sendNeteasePhoneCode('000'), /手机号格式/)
  await assert.rejects(sendKugouPhoneCode('000'), /手机号格式/)
  assert.equal(n, 0)
})

test('NetEase SMS auth sends OTP once and stores only returned session cookie', async (t) => {
  const paths = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const route = new URL(url).pathname
    paths.push(route)
    assert.equal(new URL(url).protocol, 'https:')
    assert.ok(!String(init.body).includes('123456'))
    if (route.endsWith('nuser/account/get')) return new Response(JSON.stringify({ code: 200, account: { id: 100 } }))
    const headers = new Headers()
    if (route.endsWith('login/cellphone')) headers.append('Set-Cookie', 'MUSIC_U=verified-test-session; Secure; HttpOnly; Path=/')
    return new Response(JSON.stringify({ code: 200 }), { status: 200, headers })
  })
  const phone = '13900001001'
  await sendNeteasePhoneCode(phone)
  await assert.rejects(sendNeteasePhoneCode(phone), /请稍后/)
  const cookie = await loginNeteaseWithPhoneCode(phone, '123456')
  assert.match(cookie, /MUSIC_U=verified-test-session/)
  assert.deepEqual(paths, ['/weapi/captcha/sent', '/weapi/login/cellphone', '/weapi/nuser/account/get'])
})

test('Kugou OTP requests HTTPS and never puts verification codes in URL', async (t) => {
  const observed = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const u = new URL(url)
    observed.push({ host: u.hostname, path: u.pathname, url: String(url), data: JSON.parse(init.body) })
    if (u.pathname.includes('send_mobile_code')) return new Response(JSON.stringify({ status: 1, data: { status: 1 } }))
    return new Response(JSON.stringify({ status: 1, data: { userid: '7788', token: 'test-token' } }))
  })
  const phone = '13800002345'
  await sendKugouPhoneCode(phone)
  await assert.rejects(sendKugouPhoneCode(phone), /请稍后/)
  const user = await loginKugouWithPhoneCode(phone, '123456')
  assert.deepEqual(user.userId, '7788')
  assert.ok(/^[0-9a-f]{32}$/.test(user.mid))
  assert.deepEqual(observed.map((x) => x.path), ['/v7/send_mobile_code', '/v7/login_by_verifycode'])
  assert.ok(observed.every((x) => x.url.startsWith('https://')))
  assert.ok(observed.every((x) => !x.url.includes('13800002345') && !x.url.includes('123456')))
  assert.ok(observed[1].data.params && observed[1].data.pk)
})

test('Kugou rejects stale OTP and does not leak credentials', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ status: 1, data: { status: 1 } })))
  await assert.rejects(loginKugouWithPhoneCode('13800009999', '222222'), /已过期/)
})
