import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import crypto from 'node:crypto'
test('official extension-kit signature verifies over the exact package payload',async()=>{const blob=await fs.readFile('build/unpacked/ext.tgz');const [sig,pub]=String(await fs.readFile('build/unpacked/sig')).trim().split('\n');const publicKey='-----BEGIN PUBLIC KEY-----\n'+pub+'\n-----END PUBLIC KEY-----';assert.equal(crypto.verify('sha256',blob,publicKey,Buffer.from(sig,'hex')),true)})
test('built native extension initializes using only the public AnyListen facade',async()=>{const commands=new Map();const api={command:{registerCommand:async(k,f)=>{commands.set(k,f)}},storage:{fileExists:async()=>false},logcat:{error:message=>{throw new Error(message)}}};const code=await fs.readFile('dist/main.js','utf8');vm.runInNewContext(code,{require:name=>{assert.equal(name,'any-listen');return api},setInterval:()=>0});await new Promise(r=>setTimeout(r,20));assert.deepEqual([...commands.keys()],['connect','sync','manage'])})
