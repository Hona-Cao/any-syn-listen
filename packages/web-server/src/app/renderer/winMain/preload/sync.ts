import { createProxyCallback } from 'message2call'

import type { IPCSocket } from '@/preload/ws'

import type { ClientCall, ExposeFunctions } from '.'

// 暴露给后端的方法
export const createExposeSync = (client: ClientCall) => {
  return {
    async webdavSyncStatus(socket: IPCSocket, state) {
      return client.webdavSyncStatus(state)
    },
  } satisfies Partial<ExposeFunctions>
}

// 暴露给前端的方法
export const createClientSync = (ipcSocket: IPCSocket) => {
  return {
    async runLXNSync(resolution) {
      return ipcSocket.remoteQueueSync.runLXNSync(resolution)
    },
    async getSyncState() {
      return ipcSocket.remoteQueueSync.getSyncState()
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
      return ipcSocket.remoteQueueSync.runSyncWebDAV(proxyGetListMergeMode, proxyGetDislikeMergeMode)
    },
  } satisfies Partial<AnyListen.IPC.ServerIPC>
}
