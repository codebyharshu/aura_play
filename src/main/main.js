const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const path = require('path');
const SyncWaveServer = require('../server/server');
const InternetManager = require('../server/internet/internetManager');
const WasapiCapture = require('../audio/wasapiCapture');

let mainWindow = null;
let serverInstance = null;
let internetInstance = null;
let wasapiInstance = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#0a0c13',
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getAllCombinedDevices() {
  const localDevices = (serverInstance && serverInstance.deviceManager) ?
    serverInstance.deviceManager.getAllDevicesSummary().map(d => ({ ...d, mode: 'local' })) : [];
  const internetDevices = (internetInstance) ?
    internetInstance.getAllDevicesSummary().map(d => ({ ...d, mode: 'internet' })) : [];
  return [...localDevices, ...internetDevices];
}

function initializeAudioAndServer() {
  if (!serverInstance) {
    serverInstance = new SyncWaveServer({ port: 3210, playoutDelayMs: 80 });

    serverInstance.deviceManager.on('device-request', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('device:request', { ...data, mode: 'local' });
      }
    });

    serverInstance.deviceManager.on('device-approved', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('device:approved', { ...data, mode: 'local' });
      }
    });

    serverInstance.deviceManager.on('device-disconnected', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('device:disconnected', data);
      }
    });

    serverInstance.deviceManager.on('devices-updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('devices:updated', getAllCombinedDevices());
      }
    });
  }

  if (!internetInstance) {
    internetInstance = new InternetManager({ port: 3210, playoutDelayMs: 80 });

    internetInstance.on('device-request', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('device:request', { ...data, mode: 'internet' });
      }
    });

    internetInstance.on('device-approved', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('device:approved', { ...data, mode: 'internet' });
      }
    });

    internetInstance.on('device-disconnected', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('device:disconnected', data);
      }
    });

    internetInstance.on('devices-updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('devices:updated', getAllCombinedDevices());
      }
    });
  }

  if (!wasapiInstance) {
    wasapiInstance = new WasapiCapture();

    // Stream real captured system audio directly into the sync servers (Local and Internet)
    wasapiInstance.on('audio-frame', (frame) => {
      if (serverInstance && serverInstance.isRunning) {
        serverInstance.broadcastAudio(frame.buffer, frame.format);
      }
      if (internetInstance && internetInstance.isRunning) {
        internetInstance.broadcastAudio(frame.buffer, frame.format);
      }
    });

    // Forward real-time audio visualizer samples to desktop UI
    wasapiInstance.on('visualizer-data', (samples) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('audio:visualizer-data', samples);
      }
    });

    wasapiInstance.on('error', (err) => {
      console.error('WASAPI Capture Error:', err);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('audio:error', { message: err.message });
      }
    });
  }
}

function registerIpcHandlers() {
  // Window controls
  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.close();
  });

  // Sync controls (Local Server + Native WASAPI Capture)
  ipcMain.handle('sync:start', async () => {
    try {
      initializeAudioAndServer();

      // 1. Start local HTTP & WebSocket server
      const serverDetails = await serverInstance.start();

      // 2. Start native Windows WASAPI loopback capture
      await wasapiInstance.start();
      const captureStatus = wasapiInstance.getStatus();

      const combinedStatus = {
        isBroadcasting: true,
        ...serverDetails,
        capture: {
          deviceName: captureStatus.deviceName,
          format: captureStatus.format,
          isCapturing: captureStatus.isCapturing
        }
      };

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status:changed', combinedStatus);
      }

      return { success: true, ...combinedStatus };
    } catch (err) {
      console.error('Failed to start sync and audio capture:', err);
      // Clean up on partial failure
      if (wasapiInstance) await wasapiInstance.stop();
      if (serverInstance) await serverInstance.stop();
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sync:stop', async () => {
    try {
      if (wasapiInstance) {
        await wasapiInstance.stop();
      }
      if (serverInstance) {
        await serverInstance.stop();
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status:changed', {
          isBroadcasting: false,
          activeDevices: []
        });
      }
      return { success: true };
    } catch (err) {
      console.error('Failed to stop sync and audio capture:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sync:get-status', () => {
    if (!serverInstance) return { isBroadcasting: false, activeDevices: [] };
    const details = serverInstance.getConnectionDetails();
    const captureStatus = wasapiInstance ? wasapiInstance.getStatus() : null;
    return {
      ...details,
      capture: captureStatus
    };
  });

  ipcMain.handle('sync:regenerate-token', async () => {
    if (!serverInstance) return { success: false };
    const details = await serverInstance.regenerateSession();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status:changed', {
        isBroadcasting: serverInstance.isRunning,
        ...details
      });
    }
    return { success: true, ...details };
  });

  // Master audio controls
  ipcMain.handle('audio:set-master-volume', (event, volume) => {
    if (serverInstance) {
      serverInstance.setMasterVolume(volume);
    }
    if (internetInstance) {
      internetInstance.setMasterVolume(volume);
    }
    return { success: true, volume };
  });

  ipcMain.handle('audio:set-mute', (event, isMuted) => {
    if (serverInstance) {
      serverInstance.setMute(isMuted);
    }
    if (internetInstance) {
      internetInstance.setMute(isMuted);
    }
    return { success: true, isMuted };
  });

  // Internet Mode Controls (WebRTC + STUN/TURN + Signaling)
  ipcMain.handle('internet:start', async (event, config = {}) => {
    try {
      initializeAudioAndServer();

      if (config.signalingUrl) {
        internetInstance.tunnelManager.setSignalingUrl(config.signalingUrl);
      }
      if (config.customPublicUrl) {
        internetInstance.tunnelManager.setCustomPublicUrl(config.customPublicUrl);
      }

      // 1. Start Internet Manager & resolve public URL
      const internetDetails = await internetInstance.start();

      // 2. Start native Windows WASAPI loopback capture if not already running
      await wasapiInstance.start();
      const captureStatus = wasapiInstance.getStatus();

      const combinedStatus = {
        isBroadcasting: true,
        mode: 'internet',
        ...internetDetails,
        capture: {
          deviceName: captureStatus.deviceName,
          format: captureStatus.format,
          isCapturing: captureStatus.isCapturing
        }
      };

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status:changed', combinedStatus);
      }

      return { success: true, ...combinedStatus };
    } catch (err) {
      console.error('Failed to start Internet Mode:', err);
      if (internetInstance) await internetInstance.stop();
      if (!serverInstance || !serverInstance.isRunning) {
        if (wasapiInstance) await wasapiInstance.stop();
      }
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('internet:stop', async () => {
    try {
      if (internetInstance) {
        await internetInstance.stop();
      }
      // Only stop audio capture if local mode is also stopped
      if (!serverInstance || !serverInstance.isRunning) {
        if (wasapiInstance) await wasapiInstance.stop();
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status:changed', {
          isBroadcasting: serverInstance ? serverInstance.isRunning : false,
          mode: 'internet',
          activeDevices: getAllCombinedDevices()
        });
      }
      return { success: true };
    } catch (err) {
      console.error('Failed to stop Internet Mode:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('internet:get-status', () => {
    if (!internetInstance) return { isRunning: false, activeDevices: [] };
    const details = internetInstance.getConnectionDetails();
    const captureStatus = wasapiInstance ? wasapiInstance.getStatus() : null;
    return {
      ...details,
      capture: captureStatus
    };
  });

  ipcMain.handle('internet:regenerate-token', async () => {
    if (!internetInstance) return { success: false };
    const details = await internetInstance.regenerateSession();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status:changed', {
        isBroadcasting: internetInstance.isRunning,
        mode: 'internet',
        ...details
      });
    }
    return { success: true, ...details };
  });

  // Device management (handles both Local Wi-Fi and Internet Receivers)
  ipcMain.handle('device:approve', (event, deviceId) => {
    let device = serverInstance ? serverInstance.approveDevice(deviceId) : null;
    if (!device && internetInstance) {
      device = internetInstance.approveDevice(deviceId);
    }
    return { success: !!device, device };
  });

  ipcMain.handle('device:reject', (event, { deviceId, reason }) => {
    let success = serverInstance ? serverInstance.rejectDevice(deviceId, reason) : false;
    if (!success && internetInstance) {
      success = internetInstance.rejectDevice(deviceId, reason);
    }
    return { success };
  });

  ipcMain.handle('device:disconnect', (event, { deviceId, reason }) => {
    let success = serverInstance ? serverInstance.disconnectDevice(deviceId, reason) : false;
    if (!success && internetInstance) {
      success = internetInstance.disconnectDevice(deviceId, reason);
    }
    return { success };
  });

  ipcMain.handle('device:set-volume', (event, { deviceId, volume }) => {
    let success = serverInstance ? serverInstance.setDeviceVolume(deviceId, volume) : false;
    if (!success && internetInstance) {
      success = internetInstance.setDeviceVolume(deviceId, volume);
    }
    return { success };
  });

  // Utilities
  ipcMain.handle('clipboard:copy', (event, text) => {
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('shell:open-external', (event, url) => {
    shell.openExternal(url);
    return true;
  });
}

app.whenReady().then(() => {
  initializeAudioAndServer();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  if (wasapiInstance) {
    await wasapiInstance.stop();
  }
  if (serverInstance) {
    await serverInstance.stop();
  }
  if (internetInstance) {
    await internetInstance.stop();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
