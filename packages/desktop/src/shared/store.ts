import path from 'node:path'

import Store from '@any-listen/nodejs/Store'
// import { writeFileSync } from 'atomically'
import { dialog } from 'electron'

import { appState } from '@/app'
import { log } from '@/shared/log'

const stores = new Map<string, Store>()

/**
 * 获取 Store 对象
 * @param name store 名
 * @param isIgnoredError 是否忽略错误
 * @param isShowErrorAlert=true 是否显示错误弹窗
 * @returns Store
 */
export const getStore = (name: string, isIgnoredError = true, isShowErrorAlert = true): Store => {
  if (stores.has(name)) return stores.get(name)!
  let store: Store
  const storePath = path.join(appState.dataPath, `${name}.json`)
  try {
    stores.set(name, (store = new Store(storePath, false)))
  } catch (err) {
    const error = err as Error
    log.error(error)

    // In latest-only test mode do not create a .bak file or silently reset the store.
    // Stop with the original file untouched, regardless of isIgnoredError.
    void isIgnoredError
    if (isShowErrorAlert) {
      dialog.showMessageBoxSync({
        type: 'error',
        message: `${name} data load error`,
        detail: `The existing store file was left untouched and no backup was generated: ${storePath}\nError: ${error.message}`,
      })
    }
    throw error
  }
  return store
}

export type { Store }
