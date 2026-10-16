import { ipc } from '../ipc'

export const getSyncState: AnyListen.IPC.ServerIPC['getSyncState'] = async () => {
  return ipc.getSyncState()
}

export const getExternalSyncState: AnyListen.IPC.ServerIPC['getExternalSyncState'] = async () => {
  return ipc.getExternalSyncState()
}
export const runExternalSyncNow: AnyListen.IPC.ServerIPC['runExternalSyncNow'] = async (provider, dailyOnly) => {
  return ipc.runExternalSyncNow(provider, dailyOnly)
}

export const deleteLXPlaylistsNow: AnyListen.IPC.ServerIPC['deleteLXPlaylistsNow'] = async (remoteUserIds) => {
  return ipc.deleteLXPlaylistsNow(remoteUserIds)
}

export const runSyncWebDAV: AnyListen.IPC.ServerIPC['runSyncWebDAV'] = async (getListMergeMode, getDislikeMergeMode) => {
  return ipc.runSyncWebDAV(getListMergeMode, getDislikeMergeMode)
}
