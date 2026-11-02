const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('syncwaveAPI', {
  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // Sync Controls (Local Network Mode)
  startSync: () => ipcRenderer.invoke('sync:start'),
  stopSync: () => ipcRenderer.invoke('sync:stop'),
  getStatus: () => ipcRenderer.invoke('sync:get-status'),
  regenerateToken: () => ipcRenderer.invoke('sync:regenerate-token'),

  // Sync Controls (Internet Mode - Connect from Any Network)
  startInternetSync: (config) => ipcRenderer.invoke('internet:start', config),
  stopInternetSync: () => ipcRenderer.invoke('internet:stop'),
  getInternetStatus: () => ipcRenderer.invoke('internet:get-status'),
  regenerateInternetToken: () => ipcRenderer.invoke('internet:regenerate-token'),

  // Master Audio Controls
  setMasterVolume: (volume) => ipcRenderer.invoke('audio:set-master-volume', volume),
  setMute: (isMuted) => ipcRenderer.invoke('audio:set-mute', isMuted),

  // Device Management
  approveDevice: (deviceId) => ipcRenderer.invoke('device:approve', deviceId),
  rejectDevice: (deviceId, reason) => ipcRenderer.invoke('device:reject', { deviceId, reason }),
  disconnectDevice: (deviceId, reason) => ipcRenderer.invoke('device:disconnect', { deviceId, reason }),
  setDeviceVolume: (deviceId, volume) => ipcRenderer.invoke('device:set-volume', { deviceId, volume }),

  // Clipboard & Utilities
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:copy', text),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Push Event Listeners from Main to Renderer
  onDeviceRequest: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('device:request', handler);
    return () => ipcRenderer.removeListener('device:request', handler);
  },
  onDeviceApproved: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('device:approved', handler);
    return () => ipcRenderer.removeListener('device:approved', handler);
  },
  onDeviceDisconnected: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('device:disconnected', handler);
    return () => ipcRenderer.removeListener('device:disconnected', handler);
  },
  onDevicesUpdated: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('devices:updated', handler);
    return () => ipcRenderer.removeListener('devices:updated', handler);
  },
  onAudioVisualizerData: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('audio:visualizer-data', handler);
    return () => ipcRenderer.removeListener('audio:visualizer-data', handler);
  },
  onStatusChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('status:changed', handler);
    return () => ipcRenderer.removeListener('status:changed', handler);
  }
});
