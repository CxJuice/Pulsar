const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('auxCustomization', {
  send: action => ipcRenderer.send('sc:aux-customization-action', action),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('sc:aux-customization-state', listener);
    return () => ipcRenderer.removeListener('sc:aux-customization-state', listener);
  },
});
