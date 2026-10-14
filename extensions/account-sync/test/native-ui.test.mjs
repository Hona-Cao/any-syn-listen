import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {NativeController} from '../src/native-controller.mjs'
function harness(){
 const files=new Map(),configs=new Map(),commands=new Map(),lists=new Map(),musics=new Map(),writes=[],messages=[],network=[]
 let answer=0
 const api={env:{publicKey:'public-test-key'},logcat:{warn(){},error(){}},
  configuration:{getConfigs:async keys=>keys.map(k=>configs.get(k)),setConfigs:async obj=>{for(const [k,v] of Object.entries(obj))configs.set(k,v)},onConfigChanged:()=>()=>{}},
  registerResourceAction:()=>{},command:{registerCommand:async(k,fn)=>{commands.set(k,fn)}},
  storage:{fileExists:async key=>files.has(key),readFile:async key=>files.get(key),writeFile:async(key,val)=>{files.set(key,val)}},
  utils:{crypto:{sha256:async s=>createHash('sha256').update(s).digest('hex')}},
  app:{showMessage:async (text,options)=>{messages.push({text,options});return answer},showInputDialog:async()=>''},
  musicList:{getAllUserLists:async()=>({userList:[...lists.values()]}),getListMusics:async id=>musics.get(id)||[],onListAction:()=>()=>{},listAction:async action=>{
   writes.push(action);if(action.action==='list_remove')for(const id of action.data)lists.delete(id)
   if(action.action==='list_create')for(const item of action.data.listInfos)lists.set(item.id,item)
   if(action.action==='list_music_overwrite')musics.set(action.data.listId,action.data.musicInfos)
  }},
  request:async(url,options)=>{network.push({url,options});throw new Error('Network not allowed in this test')}
 }
 return{api,files,configs,commands,lists,musics,writes,messages,network,setAnswer:x=>{answer=x}}
}
test('native manifest declares settings with the official CheckboxMultiple and command schema',async()=>{
 const manifest=JSON.parse(await fs.readFile('dist/manifest.json','utf8'))
 assert.equal(manifest.id,'hona-account-sync');assert.equal(manifest.version,'0.3.0')
 const settings=manifest.contributes.settings
 assert.ok(settings.some(x=>x.type==='configCheckboxMultiple'&&x.actionCommands.includes('loginNetease')))
 assert.equal(settings.some(x=>x.field==='selectedPlaylists'),false)
 assert.ok(manifest.contributes.resource.some(x=>x.id==='lx'&&x.resource.includes('songlist')))
 assert.ok(settings.every(x=>['configCheckboxMultiple','input'].includes(x.type)))
 assert.equal(settings.some(x=>/cookie|password/i.test(x.field)),false)
})
test('plugin populates native playlist fields without a bridge or separate GUI',async()=>{
 const h=harness();h.lists.set('a',{id:'a',name:'网易云·我喜欢',type:'general',meta:{}})
 const c=new NativeController(h.api);await c.start();clearInterval(c.timer)
 assert.equal(h.commands.size,6)
 assert.deepEqual(h.configs.get('playlistItems'),[{id:'a',name:'网易云·我喜欢'}])
 assert.equal(h.network.length,0)
 assert.equal(h.commands.has('connect'),false);assert.equal(h.commands.has('manage'),false)
})
test('native archive button uses current checkbox selection and cancel performs no write',async()=>{
 const h=harness();h.lists.set('a',{id:'a',name:'歌单 A',type:'general',meta:{}})
 const c=new NativeController(h.api);await c.engine.load()
 h.configs.set('selectedPlaylists',['a']);h.setAnswer(0)
 await c.manage('archive');assert.equal(h.writes.length,0)
 h.setAnswer(1);await c.manage('archive')
 assert.equal(h.lists.size,0);assert.ok(h.files.has('archives/native_'+c.engine.state.archives[0].id.split('native_')[1]+'.json'))
 assert.deepEqual(h.configs.get('selectedPlaylists'),[])
 assert.ok(h.configs.get('archiveItems').length===1)
 assert.equal(h.network.length,0)
})
test('native filter/all-select only selects current eligible lists',async()=>{
 const h=harness()
 for(const [id,name,type] of [['a','LX N·推荐','general'],['b','QQ音乐·我喜欢','general'],['love','我喜欢','general'],['local','本地','local']])h.lists.set(id,{id,name,type,meta:{}})
 h.configs.set('playlistFilter','LX N')
 const c=new NativeController(h.api);await c.start();clearInterval(c.timer)
 await h.api.configuration.setConfigs({selectedPlaylists:c.visible.map(x=>x.id)})
 assert.deepEqual(h.configs.get('selectedPlaylists'),['a'])
 await h.api.configuration.setConfigs({selectedPlaylists:[]});assert.deepEqual(h.configs.get('selectedPlaylists'),[])
})
test('closing native input dialogs never sends an SMS or changes credentials',async()=>{
 const h=harness();const c=new NativeController(h.api)
 await c.login('kugou');assert.equal(h.network.length,0);assert.equal(h.files.size,0)
})
test('native extension never asks the bridge to open a management UI',async()=>{
 const code=await fs.readFile('src/native-controller.mjs','utf8')
 assert.equal(code.includes("'/v1/open'"),false)
 const helper=await fs.readFile('helper-dist/main.cjs','utf8')
 assert.equal(helper.includes('ui/index.html'),false)
 assert.equal(helper.includes('main=new BrowserWindow'),false)
 assert.equal(helper.includes('account-sync-ui'),false)
 await assert.rejects(fs.access('helper-dist/ui/index.html'))
})

test('stock AnyListen with no musicList still loads native settings and registers resources',async()=>{const h=harness();delete h.api.musicList;let registered;h.api.registerResourceAction=x=>{registered=x};const c=new NativeController(h.api);await c.start();clearInterval(c.timer);assert.equal(h.commands.size,6);assert.ok(registered.songlist);assert.equal(h.configs.get('accountItems').length,3);assert.equal(h.network.length,0)})
