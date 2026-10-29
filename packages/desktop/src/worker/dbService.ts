import { startDBServiceWorker as _startDBServiceWorker, workers } from '@any-listen/app/modules/worker'
import { dialog } from 'electron'

import { appState } from '@/app'
// import { log } from '@/shared/log'
import { i18n } from '@/i18n'

const initServices = async (dataPath: string) => {
  let nativeBindingPath = './native/better_sqlite3.node'
  if (import.meta.env.DEV) nativeBindingPath = '../../node_modules/better-sqlite3/build/Release/better_sqlite3.node'

  let dbFileExists = await workers.dbService.init(
    dataPath,
    nativeBindingPath,
    appState.machineId,
    appState.appSetting['backup.backupPath'],
    false // Strict latest-only test mode: no daily or event SQLite backups
  )
  if (dbFileExists === null) {
    // No .bak, automatic reset or overwrite: leave the damaged DB untouched.
    const message = 'LX-N latest-only test mode: database integrity check failed. The original database was not moved, reset or backed up. The app will stop rather than discard data.'
    dialog.showMessageBoxSync({ type: 'error', message: i18n.t('database_verify_failed'), detail: message })
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
