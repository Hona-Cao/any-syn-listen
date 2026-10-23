import { createProxyCallback } from 'message2call'

import type { ClientCall, ExposeFunctions, MainCall } from '.'

// 暴露给后端的方法
export const createExposeSync = (client: ClientCall) => {
  return {
    async webdavSyncStatus(event, state) {
      return client.webdavSyncStatus(state)
    },
  } satisfies Partial<ExposeFunctions>
}

// 暴露给前端的方法
export const createClientSync = (main: MainCall) => {
  return {
    async runLXNSync() {
      return main.runLXNSync()
    },
    async getSyncState() {
      return main.getSyncState()
    },
    async runSyncWebDAV(getListMergeMode, getDislikeMergeMode) {
      const proxyGetListMergeMode = getListMergeMode
        ? createProxyCallback(async (): Promise<AnyListen.List.MergeMode> => {
            proxyGetListMergeMode!.releaseProxy()
            return getListMergeMode()
          })
        : undefined
      const proxyGetDislikeMergeMode = getDislikeMergeMode
        ? createProxyCallback(async (): Promise<AnyListen.Dislike.MergeMode> => {
            proxyGetDislikeMergeMode!.releaseProxy()
            return getDislikeMergeMode()
          })
        : undefined
      return main.runSyncWebDAV(proxyGetListMergeMode, proxyGetDislikeMergeMode)
    },
  } satisfies Partial<AnyListen.IPC.ServerIPC>
}
