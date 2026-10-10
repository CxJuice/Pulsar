const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scKit', {
  presence: target => ipcRenderer.invoke('sc:presence', target),
  loginPresence: project => ipcRenderer.invoke('sc:presence-login', project),
  onPresence: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('sc:presence-state', listener); return () => ipcRenderer.removeListener('sc:presence-state', listener); },
  request: (action, payload = {}) => ipcRenderer.invoke('sc:request', action, payload),
  connect: (token, remember, project) => ipcRenderer.invoke('sc:connect', token, remember, project),
  login: (project) => ipcRenderer.invoke('sc:login', project),
  disconnect: () => ipcRenderer.invoke('sc:disconnect'),
  openExternal: (url) => ipcRenderer.invoke('sc:external', url),
  exportData: (content, defaultName) => ipcRenderer.invoke('sc:export', content, defaultName),
  window: (action) => ipcRenderer.send('sc:window', action),
});
