import { getSyncWebDAVState, runSyncWebDAV, runLXNSync } from '@/modules/sync'

import type { ExposeFunctions } from '.'

// 暴露给前端的方法
export const createExposeSync = () => {
  return {
    async getSyncState() {
      const webdavState = getSyncWebDAVState()

      return {
        webdav: {
          status: webdavState.status,
          error: webdavState.error?.message,
          nextSyncTime: webdavState.nextSyncTime,
        },
      }
    },
    async runLXNSync(event, resolution) {
      return runLXNSync(resolution)
    },
    async runSyncWebDAV(event, getListMergeMode, getDislikeMergeMode) {
      return runSyncWebDAV(getListMergeMode, getDislikeMergeMode)
    },
  } satisfies Partial<ExposeFunctions>
}
