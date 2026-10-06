const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ff14Desktop', {
  isDesktop: true,
  exportBackup: backup => ipcRenderer.invoke('backup:export', backup),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  // 保留现有接口名称；返回 { started, message }，只在明确确认后调用。
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
