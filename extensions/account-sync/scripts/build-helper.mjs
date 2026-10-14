import {build} from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
await fs.mkdir('helper-dist',{recursive:true})
await build({entryPoints:['helper/providers/index.ts'],bundle:true,platform:'node',target:'node22',format:'cjs',tsconfig:'tsconfig.json',outfile:'helper-dist/providers.cjs'})
for(const f of ['main.cjs','preload.cjs','relay.mjs','package.json'])await fs.copyFile('helper/'+f,'helper-dist/'+f)
await fs.cp('helper/ui','helper-dist/ui',{recursive:true})
console.log('Helper compiled')
