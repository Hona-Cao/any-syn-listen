import fs from 'node:fs'
import crypto from 'node:crypto'
if (!fs.existsSync('.env')) {
 const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'der'},publicKeyEncoding:{type:'spki',format:'der'}})
 fs.writeFileSync('.env','PRI_KEY='+key.privateKey.toString('base64')+'\nPUB_KEY='+key.publicKey.toString('base64')+'\n',{mode:0o600})
}
console.log('Signing key ready')
