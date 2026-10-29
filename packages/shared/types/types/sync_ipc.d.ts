declare namespace AnyListen {
  namespace IPCSync {
    type SyncStatus = 'idle' | 'waiting' | 'syncing' | 'error'

    interface SyncState {
      webdav: {
        status: SyncStatus
        error?: string
        nextSyncTime: number
      }
    }

    type ServerActions = WarpPromiseRecord<{
      getSyncState: () => SyncState
      runLXNSync: (resolution?: 'remote' | 'local') => Promise<{
        action: 'downloaded' | 'uploaded' | 'unchanged'
        listCount: number
        remoteTimestamp: number
      }>
      runSyncWebDAV: (
        getListMergeMode?: () => Promise<List.MergeMode>,
        getDislikeMergeMode?: () => Promise<Dislike.MergeMode>
      ) => Promise<void>
    }>
    type ServerIPCActions<Socket = undefined> = IPC.WarpIPCHandlerActions<Socket, ServerActions>

    type ClientActions = WarpPromiseRecord<{
      webdavSyncStatus: (state: SyncState['webdav']) => void
    }>
    type ClientIPCActions<Socket = undefined> = IPC.WarpIPCHandlerActions<Socket, ClientActions>
  }
}
