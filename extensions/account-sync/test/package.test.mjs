import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import crypto from 'node:crypto'
test('official extension-kit signature verifies over the exact package payload',async()=>{const blob=await fs.readFile('build/unpacked/ext.tgz');const [sig,pub]=String(await fs.readFile('build/unpacked/sig')).trim().split('\n');const publicKey='-----BEGIN PUBLIC KEY-----\n'+pub+'\n-----END PUBLIC KEY-----';assert.equal(crypto.verify('sha256',blob,publicKey,Buffer.from(sig,'hex')),true)})
