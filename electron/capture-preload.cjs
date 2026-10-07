const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('purchaseCapture', {
  onImage: callback => ipcRenderer.on('purchase:capture-image', (_event, image) => callback(image)),
  complete: selection => ipcRenderer.send('purchase:capture-selection', selection)
});
