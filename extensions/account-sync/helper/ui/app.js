import {Selection} from './selection.mjs'
const $=id=>document.getElementById(id)
let state={clients:[],queue:[]},clientId='',tab='accounts',platform=null,cooldown=null,lastGrid=''
const selection=new Selection()
async function call(action,data){const r=await window.accountSync.call(action,data);if(!r.ok)throw new Error(r.error||'操作失败');return r.value}
function notice(text){$('notice').textContent=text||''}
function current(){return state.clients.find(c=>c.id===clientId)||state.clients[0]}
function visible(){const q=$('filter').value.toLowerCase();return (current()?.lists??[]).filter(x=>x.name.toLowerCase().includes(q))}
function setTab(name){tab=name;for(const k of ['accounts','lists','archives'])$(k).hidden=k!==name;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));render()}
function counts(){const n=selection.ids.size;$('count').textContent=n+' 已选';$('archive').disabled=$('delete').disabled=!n||!current()?.online}
function drawGrid(force=false){const lists=visible();selection.prune((current()?.lists??[]).map(x=>x.id));const signature=JSON.stringify([lists,clientId]);if(!force&&signature===lastGrid){counts();return}lastGrid=signature
 const fragment=document.createDocumentFragment()
 for(const row of lists){const el=document.createElement('div');el.className='playlist-row';el.setAttribute('role','row');el.tabIndex=0;el.dataset.id=row.id
  const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label',row.name)
  const title=document.createElement('span');title.className='playlist-name';title.textContent=row.name
  const count=document.createElement('span');count.className='playlist-count';count.textContent=(row.songCount??0)+' 首'
  el.append(check,title,count)
  const click=e=>{e.preventDefault();selection.click(row.id,visible().map(x=>x.id),{ctrl:e.ctrlKey||e.metaKey,shift:e.shiftKey,checkbox:e.target===check});updateRows()}
  el.addEventListener('click',click);el.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter')click(e)})
  fragment.append(el)
 }
 $('playlist-grid').replaceChildren(fragment);updateRows();$('empty').textContent=lists.length?'':current()?'暂无歌单':'先连接 AnyListen 扩展'
}
function updateRows(){document.querySelectorAll('.playlist-row').forEach(el=>{const yes=selection.ids.has(el.dataset.id);el.classList.toggle('selected',yes);el.setAttribute('aria-selected',String(yes));el.querySelector('input').checked=yes});counts()}
function renderArchives(){const list=current()?.archives??[];const frag=document.createDocumentFragment();for(const ar of [...list].reverse()){
 const el=document.createElement('div');el.className='archive-row';const name=document.createElement('span');name.className='name';name.textContent=(ar.kind==='delete'?'回收站':'归档')+' · '+ar.names.join('、');const count=document.createElement('span');count.className='muted';count.textContent=ar.count+' 个'
 const restore=document.createElement('button');restore.textContent=ar.restoredAt?'已恢复':'恢复';restore.disabled=!!ar.restoredAt||!current()?.online;restore.onclick=()=>perform('restore',{archiveId:ar.id});el.append(name,count,restore);frag.append(el)
 }$('archive-list').replaceChildren(frag);$('archive-empty').textContent=list.length?'':'暂无归档'
}
function accountLabel(a){if(!a?.connected)return '未登录';if(a.stage==='syncing')return '同步中';if(a.stage==='error')return a.error||'同步失败';if(a.count!=null)return a.count+' 个歌单 · '+(a.tracks??0)+' 首';return '已登录'}
function render(){for(const id of ['netease','qqmusic','kugou'])$(id+'-state').textContent=accountLabel(state.accounts?.[id]);$('lx-state').textContent=state.webdav?.stage==='error'?state.webdav.error:state.webdav?.configured?(state.webdav.count??0)+' 个歌单':''
 const old=$('client').value;const options=state.clients.map(c=>({id:c.id,label:c.label+' · '+c.id.slice(0,6)}));if(JSON.stringify(options)!==$('client').dataset.options){$('client').replaceChildren(...options.map(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=x.label;return o}));$('client').dataset.options=JSON.stringify(options);$('client').value=options.some(x=>x.id===old)?old:(options[0]?.id??'')}
 clientId=$('client').value;$('online').textContent=current()?.online?'已连接':'未连接';if(tab==='lists')drawGrid();if(tab==='archives')renderArchives()
 $('pairbox').hidden=!state.pairCode;$('paircode').textContent=state.pairCode||''
 const pending=state.queue.find(x=>x.clientId===clientId&&x.status==='pending');if(pending)notice('等待播放器完成操作…')
 const last=state.queue.filter(x=>x.clientId===clientId&&x.status!=='pending').at(-1);if(last&&last.id!==render.lastResult){render.lastResult=last.id;notice(last.status==='done'?'操作完成':last.result?.error||'操作失败')}
}
async function poll(){try{state=await call('state');render()}catch(e){notice(e.message)}}
async function perform(kind,extra={}){try{const c=current();if(!c?.online)throw new Error('请打开已连接的 AnyListen');const ids=[...selection.ids];if((kind==='delete'||kind==='archive')&&!confirm((kind==='delete'?'删除':'归档')+'选中的 '+ids.length+' 个本地歌单？'))return;await call('operation',{clientId:c.id,kind,ids,...extra});selection.clear();drawGrid(true);notice('等待播放器完成操作…');await poll()}catch(e){notice(e.message)}}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab))
$('pair').onclick=async()=>{try{await call('pairing');await poll()}catch(e){notice(e.message)}}
$('refresh').onclick=async()=>{try{await call('refresh');notice('正在同步');await poll()}catch(e){notice(e.message)}}
$('client').onchange=()=>{clientId=$('client').value;selection.clear();drawGrid(true)}
$('filter').oninput=()=>{selection.clear();drawGrid(true)}
$('select-all').onclick=()=>{selection.all(visible().map(x=>x.id));updateRows()}
$('clear').onclick=()=>{selection.clear();updateRows()}
$('archive').onclick=()=>perform('archive');$('delete').onclick=()=>perform('delete')
document.addEventListener('keydown',e=>{if(tab!=='lists'||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();selection.all(visible().map(x=>x.id));updateRows()}if(e.key==='Escape'){selection.clear();updateRows()}})
document.querySelectorAll('[data-login]').forEach(b=>b.onclick=()=>{platform=b.dataset.login;$('login-title').textContent=(platform==='netease'?'网易云':'酷狗')+'账号登录';$('login-form').reset();$('login-status').textContent='';$('login-dialog').showModal()})
$('login-cancel').onclick=()=>$('login-dialog').close()
$('send-code').onclick=async()=>{const phone=$('phone').value.trim();if(!/^1\d{10}$/.test(phone)){$('login-status').textContent='手机号格式不正确';return}const button=$('send-code');button.disabled=true;try{await call('sms',{platform,phone});$('login-status').textContent='验证码已发送';let seconds=60;button.textContent=seconds+'s';clearInterval(cooldown);cooldown=setInterval(()=>{button.textContent=(--seconds)+'s';if(seconds<=0){clearInterval(cooldown);button.disabled=false;button.textContent='获取验证码'}},1000)}catch(e){$('login-status').textContent=e.message;button.disabled=false}}
$('login-form').onsubmit=async e=>{e.preventDefault();const btn=$('login-submit');btn.disabled=true;try{await call('login',{platform,phone:$('phone').value.trim(),code:$('code').value.trim()});$('code').value='';$('login-dialog').close();notice('登录成功');await poll()}catch(error){$('login-status').textContent=error.message}finally{btn.disabled=false}}
$('qq-login').onclick=async()=>{const btn=$('qq-login');btn.disabled=true;try{if(await call('qqLogin'))notice('登录成功');await poll()}catch(e){notice(e.message)}finally{btn.disabled=false}}
$('webdav-form').onsubmit=async e=>{e.preventDefault();try{const data=Object.fromEntries(new FormData(e.target));await call('webdav',data);e.target.elements.password.value='';notice('已保存');await poll()}catch(error){notice(error.message)}}
await poll();setInterval(poll,3000)
