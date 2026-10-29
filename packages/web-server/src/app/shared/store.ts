// import { writeFileSync } from 'atomically'
import path from 'node:path'

import Store from '@any-listen/nodejs/Store'

import { appState } from '@/app/app'
import { log } from '@/app/shared/log'

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

    // Latest-only test mode: leave malformed data untouched, never create .bak.
    void isIgnoredError
    if (isShowErrorAlert) {
      log.warn(`${name} data load error; original store preserved and no backup was generated: ${storePath}`)
    }
    throw error
  }
  return store
}

export type { Store }
