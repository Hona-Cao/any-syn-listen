import fs from 'node:fs/promises'
const out='release/AnyListenAccountHelper'
try{await fs.access(out);throw new Error('Release directory already exists; choose a new empty directory')}catch(e){if(e.code!=='ENOENT')throw e}
await fs.cp('node_modules/electron/dist',out,{recursive:true})
await fs.rename(out+'/electron.exe',out+'/AnyListenAccountHelper.exe')
await fs.cp('helper-dist',out+'/resources/app',{recursive:true,filter:source=>!source.endsWith('ui-smoke.png')})
await fs.copyFile('build/hona-account-sync_v0.1.0.alix',out+'/hona-account-sync_v0.1.0.alix')
await fs.copyFile('README.md',out+'/使用说明.md')
console.log(out)
