import fs from 'node:fs/promises'
const version=JSON.parse(await fs.readFile('package.json','utf8')).version
const out='release/AnyListenAccountBridge-'+version
try{await fs.access(out);throw new Error('Release directory already exists')}catch(e){if(e.code!=='ENOENT')throw e}
await fs.cp('node_modules/electron/dist',out,{recursive:true})
await fs.rename(out+'/electron.exe',out+'/AnyListenAccountBridge.exe')
await fs.cp('helper-dist',out+'/resources/app',{recursive:true})
await fs.copyFile('build/hona-account-sync_v'+version+'.alix',out+'/hona-account-sync_v'+version+'.alix')
await fs.copyFile('README.md',out+'/README.md')
console.log(out)
