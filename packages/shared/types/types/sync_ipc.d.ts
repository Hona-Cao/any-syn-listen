declare namespace AnyListen {
  namespace IPCSync {
    type SyncStatus = 'idle' | 'waiting' | 'syncing' | 'error'

    type ExternalProvider = 'netease' | 'qq' | 'kugou' | 'lx'
    interface ExternalState {
      status: 'idle' | 'syncing' | 'success' | 'error'
      lastSuccess: number
      lastTry: number
      error?: string
    }
    interface SyncState {
      webdav: {
        status: SyncStatus
        error?: string
        nextSyncTime: number
      }
    }

    type ServerActions = WarpPromiseRecord<{
      getSyncState: () => SyncState
      getExternalSyncState: () => Record<ExternalProvider, ExternalState>
      runExternalSyncNow: (provider: ExternalProvider, dailyOnly?: boolean) => void
      deleteLXPlaylistsNow: (remoteUserIds: string[]) => number
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
