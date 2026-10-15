import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dailyHistoryKey, addOptionalDailyHistory,
} from '../../shared/app/modules/sync/external/dailyHistory.ts'

const daily = (name='网易云·每日推荐') => ({
  key: 'daily', name, list: [{ id: 'wy_12', name: '推荐', singer: 'S', interval: null, isLocal: false, meta: {} }],
})
test('disabled daily history does not clone account recommendation', () => {
  const list = [daily()]
  assert.equal(addOptionalDailyHistory(list, false).length, 1)
})
test('enabled daily history saves a dated, archived, standalone snapshot', () => {
  const list = [daily()]
  const result = addOptionalDailyHistory(list, true, new Date('2026-10-15T23:15:00+08:00'))
  assert.equal(result.length, 2)
  assert.deepEqual(result.map(item => item.key), ['daily', 'daily-history:2026-10-15'])
  assert.equal(result[1].name, '网易云·每日推荐 2026-10-15')
  assert.equal(result[1].archived, true)
  assert.notEqual(result[1].list, result[0].list)
})
test('respects China/Singapore day change independent of OS timezone', () => {
  assert.equal(dailyHistoryKey(new Date('2026-10-15T16:15:00Z')), '2026-10-16')
})
test('empty daily recommendation and account-only lists do not create history', () => {
  assert.equal(addOptionalDailyHistory([{ key:'daily',name:'QQ·每日推荐',list:[]}],true).length,1)
  assert.equal(addOptionalDailyHistory([{ key:'playlist:a',name:'账号歌单',list:[]}],true).length,1)
})
