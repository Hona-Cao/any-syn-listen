import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { safeStorage } from 'electron'

import { appState } from '@/app'

type Platform = 'netease' | 'qqmusic' | 'kugou'
const secretPath = (platform: Platform) => path.join(appState.dataPath, 'secrets', platform + '-session.bin')

/**
 * On Linux, Electron's "basic_text" safeStorage is *not* encryption.
 * Never silently fall back to writing plaintext credentials to disk.
 */
export const accountVaultAvailable = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')

export const readAccountSecret = async (platform: Platform): Promise<string> => {
  if (!accountVaultAvailable()) return ''
  let ciphertext: Buffer
  try {
    ciphertext = await readFile(secretPath(platform))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
  try {
    return safeStorage.decryptString(ciphertext)
  } catch {
    return ''
  }
}
export const writeAccountSecret = async (platform: Platform, value: string): Promise<void> => {
  if (!accountVaultAvailable()) throw new Error('系统安全存储不可用，请先解锁系统钥匙串')
  const file = secretPath(platform)
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = file + '.tmp'
  await writeFile(tmp, safeStorage.encryptString(value), { mode: 0o600 })
  await rename(tmp, file)
}
