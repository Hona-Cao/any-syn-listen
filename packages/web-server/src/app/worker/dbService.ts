import { startDBServiceWorker as _startDBServiceWorker, workers } from '@any-listen/app/modules/worker'
import { getNativeName } from '@any-listen/nodejs'

// import { log } from '@/shared/log'
import { appLog } from '@/shared/log4js'

import { appState } from '../app'

const initServices = async (dataPath: string) => {
  let nativeBindingPath = `../native/${getNativeName()}/better_sqlite3.node`
  if (import.meta.env.DEV) nativeBindingPath = '../node_modules/better-sqlite3/build/Release/better_sqlite3.node'

  let dbFileExists = await workers.dbService.init(dataPath, nativeBindingPath, appState.machineId, undefined, false)
  if (dbFileExists === null) {
    const message = 'LX-N latest-only mode: database integrity check failed. Database preserved, no automatic backup or reset.'
    appLog.error(message)
    throw new Error(message)
  }
}

export const startDBServiceWorker = async (dataPath: string) => {
  return new Promise<void>((resolve, reject) => {
    void _startDBServiceWorker(() => {
      initServices(dataPath).then(resolve).catch(reject)
    }).catch(reject)
  })
}
