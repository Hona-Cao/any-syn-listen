import {build} from 'esbuild'
import fs from 'node:fs/promises'
await fs.mkdir('helper-dist',{recursive:true})
await fs.rm('helper-dist/ui',{recursive:true,force:true})
await fs.rm('helper-dist/preload.cjs',{force:true})
await build({entryPoints:['helper/providers/index.ts'],bundle:true,platform:'node',target:'node22',format:'cjs',tsconfig:'tsconfig.json',outfile:'helper-dist/providers.cjs'})
for(const f of ['main.cjs','relay.mjs','package.json'])await fs.copyFile('helper/'+f,'helper-dist/'+f)
console.log('Headless login component compiled; no management HTML is packaged')
