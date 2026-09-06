const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ff14Desktop', {
  isDesktop: true,
  exportBackup: backup => ipcRenderer.invoke('backup:export', backup),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  restartToUpdate: () => ipcRenderer.invoke('updater:restart'),
  getDataStatus: () => ipcRenderer.invoke('data:status'),
  loadDataBundle: () => ipcRenderer.invoke('data:load'),
  checkDataUpdates: () => ipcRenderer.invoke('data:check'),
  applyDataUpdate: () => ipcRenderer.invoke('data:apply'),
  onUpdateStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  }
});
