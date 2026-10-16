import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planPlatformPreference } from '../../shared/app/modules/sync/external/platformPreference.ts'

test('a NetEase favorite is the only currently verified platform like write', () => {
  assert.deepEqual(planPlatformPreference({ source:'wy',musicId:'12345',action:'like' }),{
    kind:'netease-song-like',musicId:'12345',liked:true,platform:'网易云',
  })
  assert.deepEqual(planPlatformPreference({ source:'wy',musicId:'12345',action:'unlike' }),{
    kind:'netease-song-like',musicId:'12345',liked:false,platform:'网易云',
  })
})
test('dislike remains local-only even for authenticated NetEase', () => {
  const x=planPlatformPreference({source:'wy',musicId:'123',action:'dislike'})
  assert.deepEqual(x,{kind:'local-only',platform:'网易云',reason:'unsupported-action'})
})
test('QQ and Kugou do not claim unverified remote preference writes', () => {
  for (const [source,platform] of [['tx','QQ 音乐'],['kg','酷狗']]) {
    const x=planPlatformPreference({source,musicId:'123',action:'like'})
    assert.deepEqual(x,{kind:'local-only',platform,reason:'unsupported-provider'})
  }
})
test('an invalid NetEase track identity cannot be transmitted to the platform', () => {
  for (const musicId of ['wy_123','123;foo=bar','',String(1).repeat(25)]) {
    const x=planPlatformPreference({source:'wy',musicId,action:'like'})
    assert.deepEqual(x,{kind:'local-only',platform:'网易云',reason:'invalid-id'})
  }
})
