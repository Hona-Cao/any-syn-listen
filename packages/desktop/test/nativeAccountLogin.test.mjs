import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTH_PARTITIONS,
  isTrustedLoginURL,
  musicCookieHeader,
  neteaseHasAuthenticatedCookie,
  isNeteaseAccountVerified,
  qqCredentialFromSession,
} from '../src/modules/accountLoginPolicy.ts'

test('NetEase popup OAuth stays inside the isolated Chromium login partition', () => {
  assert.equal(AUTH_PARTITIONS.netease,'persist:netease-auth')
  for (const url of [
    'https://music.163.com/m/login',
    'https://passport.163.com/',
    'https://reg.163.com/',
    'https://dl.reg.163.com/validate',
    'https://urs.163.com/login',
  ]) assert.equal(isTrustedLoginURL('netease',url),true,url)
  for (const url of [
    'http://music.163.com/login',
    'https://music.163.com.attacker.invalid/path',
    'https://evil.163.com/path',
    'https://music.163.com@attacker.invalid/',
    'https://user:secret@music.163.com/',
    'https://music.163.com:8080/',
    'javascript:alert(1)',
    'file:///c:/test.html',
  ]) assert.equal(isTrustedLoginURL('netease',url),false,url)
})
test('QQ and WeChat OAuth use only official HTTPS domains', () => {
  for (const url of [
    'https://y.qq.com/n/ryqq/profile',
    'https://open.weixin.qq.com/connect/qrconnect',
    'https://lp.open.weixin.qq.com/connect/l/qrconnect',
    'https://xui.ptlogin2.qq.com/ptqrlogin',
    'https://graph.qq.com/oauth2.0/show',
  ]) assert.equal(isTrustedLoginURL('qqmusic',url),true,url)
  for (const url of [
    'http://open.weixin.qq.com/',
    'https://qq.com.attacker.invalid/',
    'https://weixin.qq.com.attacker.invalid/',
    'https://music.163.com/',
  ]) assert.equal(isTrustedLoginURL('qqmusic',url),false,url)
})
test('NetEase login is verified using account id, not a page or Cookie alone', () => {
  const cookie=musicCookieHeader([
    {name:'MUSIC_U',value:'example'},
    {name:'__csrf',value:'test'},
    {name:'example',value:'secret\r\nInjected:1'},
    {name:'bad:name',value:'test'},
  ])
  assert.equal(cookie,'MUSIC_U=example; __csrf=test')
  assert.equal(neteaseHasAuthenticatedCookie(cookie),true)
  assert.equal(neteaseHasAuthenticatedCookie('__csrf=test'),false)
  assert.equal(isNeteaseAccountVerified({code:200,account:{id:123}}),true)
  assert.equal(isNeteaseAccountVerified({code:200,account:null}),false)
  assert.equal(isNeteaseAccountVerified({code:301,account:{id:123}}),false)
  assert.equal(isNeteaseAccountVerified({code:200,account:{id:0}}),false)
  assert.equal(isNeteaseAccountVerified({code:200,account:{id:'123'}}),false)
})
test('QQ recognition requires provider-domain musicid and qqmusic_key', () => {
  const mock=[
    {name:'qqmusic_key',value:'legit',domain:'.qq.com'},
    {name:'musicid',value:'12345678',domain:'.qq.com'},
    {name:'musicid',value:'99999999',domain:'.attacker.invalid'},
  ]
  assert.deepEqual(qqCredentialFromSession(mock),{musicId:'12345678',musicKey:'legit'})
  assert.equal(qqCredentialFromSession([mock[2]]),null)
  assert.equal(qqCredentialFromSession([{name:'musicid',value:'12345',domain:'.qq.com'}]),null)
})
