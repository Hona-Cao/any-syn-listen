const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('accountSync', {
  call: (action, data) => ipcRenderer.invoke('account-sync-ui', action, data),
})
