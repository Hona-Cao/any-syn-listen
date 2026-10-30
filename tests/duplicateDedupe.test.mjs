import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDuplicateRemovalPlan, getMusicQualityRank, duplicateListFingerprint } from '../packages/view-main/src/components/common/MusicList/List/components/DuplicateMusicModal/dedupe.ts'

const song = (id, options={}) => ({
  id, name: options.name ?? '阿刁', singer: options.singer ?? '赵雷',
  interval: options.interval ?? '06:14', isLocal: false,
  meta: { createTime: options.time ?? 0, qualitys: options.quality ? {[options.quality]: { sizeStr:'20MB' }} : {},
    source: 'wy', musicId:id, albumName:'', updateTime:0, posTime:0 },
})
const entry = (musicInfo,index,group='阿刁')=>({group,index,musicInfo})
const plan=(items,rule,side='top')=>buildDuplicateRemovalPlan(items,rule,side)

test('highest available quality beats lower qualities and retains one song',()=>{
  const items=[entry(song('sq',{quality:'flac'}),0),entry(song('master',{quality:'master'}),1),entry(song('hr',{quality:'flac24bit'}),2)]
  assert.deepEqual(plan(items,'quality').keepIds,['master'])
  assert.deepEqual(plan(items,'quality').removeIds,['sq','hr'])
  assert.equal(getMusicQualityRank(items[1].musicInfo)>getMusicQualityRank(items[0].musicInfo),true)
})
test('same normalized title but different singers/versions/durations are NOT auto-deleted',()=>{
  const items=[
    entry(song('original',{name:'Track',singer:'A',interval:'03:00'}),0,'track'),
    entry(song('cover',{name:'Track',singer:'B',interval:'03:00'}),1,'track'),
    entry(song('live',{name:'Track (Live)',singer:'A',interval:'03:00'}),2,'track'),
    entry(song('extended',{name:'Track',singer:'A',interval:'04:00'}),3,'track'),
  ]
  assert.deepEqual(plan(items,'quality').removeIds,[])
})
test('time strategies use real positive timestamps regardless of list position',()=>{
  const items=[entry(song('new',{time:300}),0),entry(song('old',{time:100}),1),entry(song('middle',{time:200}),2)]
  assert.deepEqual(plan(items,'earliest').keepIds,['old'])
  assert.deepEqual(plan(items,'latest').keepIds,['new'])
  assert.equal(plan(items,'earliest').timeFallbackGroups,0)
})
test('LX-N zero timestamps use current list positions and insertion setting',()=>{
  const items=[entry(song('top'),0),entry(song('bottom'),1)]
  assert.deepEqual(plan(items,'earliest','top').keepIds,['bottom'])
  assert.deepEqual(plan(items,'latest','top').keepIds,['top'])
  assert.deepEqual(plan(items,'earliest','bottom').keepIds,['top'])
  assert.deepEqual(plan(items,'latest','bottom').keepIds,['bottom'])
  assert.equal(plan(items,'earliest','top').timeFallbackGroups,1)
})
test('quality ties use stable earlier-added preference',()=>{
  const items=[entry(song('earlier',{quality:'flac'}),1),entry(song('later',{quality:'flac'}),0)]
  assert.deepEqual(plan(items,'quality','top').keepIds,['earlier'])
})
test('duplicate ID is not auto-deleted, even if it appears twice in displayed result',()=>{
  const items=[entry(song('a'),0),entry(song('a'),1)]
  assert.deepEqual(plan(items,'quality').removeIds,[])
})
test('fingerprint changes after source metadata quality or music order changes',()=>{
  const a=song('a',{quality:'flac'}),b=song('b',{quality:'master'})
  assert.notEqual(duplicateListFingerprint([a,b]),duplicateListFingerprint([b,a]))
  assert.notEqual(duplicateListFingerprint([a]),duplicateListFingerprint([song('a',{quality:'master'})]))
})
test('no duplicate creates empty deletion plan',()=>{
  assert.deepEqual(plan([entry(song('a'),0)],'quality'),{keepIds:[],removeIds:[],groupCount:0,timeFallbackGroups:0})
})

test('quality selection follows Any Listen source ordering, preferring FLAC over WAV',()=>{
  const wav = song('wav',{quality:'wav'}),flac = song('flac',{quality:'flac'})
  assert.ok(getMusicQualityRank(flac)>getMusicQualityRank(wav))
})
