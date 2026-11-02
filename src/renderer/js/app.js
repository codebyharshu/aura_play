document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const minBtn = document.getElementById('minBtn');
  const maxBtn = document.getElementById('maxBtn');
  const closeBtn = document.getElementById('closeBtn');

  const startSyncBtn = document.getElementById('startSyncBtn');
  const stopSyncBtn = document.getElementById('stopSyncBtn');

  const broadcastStatusPill = document.getElementById('broadcastStatusPill');
  const broadcastStatusText = document.getElementById('broadcastStatusText');
  const networkBadge = document.getElementById('networkBadge');
  const headerIPText = document.getElementById('headerIPText');
  const captureEngineName = document.getElementById('captureEngineName');
  const audioCaptureBadge = document.getElementById('audioCaptureBadge');

  const qrPlaceholder = document.getElementById('qrPlaceholder');
  const qrImage = document.getElementById('qrImage');
  const connectionUrlInput = document.getElementById('connectionUrlInput');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const copyBtnText = document.getElementById('copyBtnText');

  const masterVolumeSlider = document.getElementById('masterVolumeSlider');
  const masterVolumeVal = document.getElementById('masterVolumeVal');
  const muteToggleBtn = document.getElementById('muteToggleBtn');
  const regenTokenBtn = document.getElementById('regenTokenBtn');

  // Mode Selector Elements
  const modeLocalBtn = document.getElementById('modeLocalBtn');
  const modeInternetBtn = document.getElementById('modeInternetBtn');
  const connectionCardSubtitle = document.getElementById('connectionCardSubtitle');
  const securityBadgeText = document.getElementById('securityBadgeText');
  const securityNoticeText = document.getElementById('securityNoticeText');
  const step1Text = document.getElementById('step1Text');
  const step2Text = document.getElementById('step2Text');
  const step3Text = document.getElementById('step3Text');
  const qrPlaceholderText = document.getElementById('qrPlaceholderText');
  const connectionUrlLabel = document.getElementById('connectionUrlLabel');

  // Settings Modal Elements
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const internetSettingsModal = document.getElementById('internetSettingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const cfgSignalingUrl = document.getElementById('cfgSignalingUrl');
  const cfgTurnUrl = document.getElementById('cfgTurnUrl');

  let activeMode = 'local'; // 'local' or 'internet'
  let localBroadcastingState = null;
  let internetBroadcastingState = null;
  let isMuted = false;

  const deviceCountVal = document.getElementById('deviceCountVal');
  const deviceListContainer = document.getElementById('deviceListContainer');
  const emptyDevicesView = document.getElementById('emptyDevicesView');

  // Modal elements
  const approvalModalBackdrop = document.getElementById('approvalModalBackdrop');
  const reqDeviceName = document.getElementById('reqDeviceName');
  const reqDeviceIP = document.getElementById('reqDeviceIP');
  const reqDeviceType = document.getElementById('reqDeviceType');
  const reqDeviceMode = document.getElementById('reqDeviceMode');
  const approveDeviceBtn = document.getElementById('approveDeviceBtn');
  const rejectDeviceBtn = document.getElementById('rejectDeviceBtn');

  let currentPendingRequest = null;
  let activeDevices = [];
  const deviceMuteStates = new Map();

  // Initialize Visualizer
  const visualizer = new AudioVisualizer('visualizerCanvas');

  // Window Controls
  if (minBtn) minBtn.addEventListener('click', () => window.syncwaveAPI.minimizeWindow());
  if (maxBtn) maxBtn.addEventListener('click', () => window.syncwaveAPI.maximizeWindow());
  if (closeBtn) closeBtn.addEventListener('click', () => window.syncwaveAPI.closeWindow());

  // Master Volume Slider & Mute
  if (masterVolumeSlider) {
    masterVolumeSlider.addEventListener('input', async (e) => {
      const val = parseInt(e.target.value, 10);
      if (masterVolumeVal) masterVolumeVal.textContent = `${val}%`;
      if (isMuted && val > 0) {
        isMuted = false;
        if (muteToggleBtn) muteToggleBtn.classList.remove('muted');
      }
      await window.syncwaveAPI.setMasterVolume(val / 100);
    });
  }

  if (muteToggleBtn) {
    muteToggleBtn.addEventListener('click', async () => {
      isMuted = !isMuted;
      muteToggleBtn.classList.toggle('muted', isMuted);
      if (isMuted) {
        if (masterVolumeVal) masterVolumeVal.textContent = 'Muted';
      } else {
        if (masterVolumeVal && masterVolumeSlider) masterVolumeVal.textContent = `${masterVolumeSlider.value}%`;
      }
      await window.syncwaveAPI.setMute(isMuted);
    });
  }

  // Mode Switching Listeners
  if (modeLocalBtn) {
    modeLocalBtn.addEventListener('click', () => switchMode('local'));
  }
  if (modeInternetBtn) {
    modeInternetBtn.addEventListener('click', () => switchMode('internet'));
  }

  // Settings Modal Listeners
  if (openSettingsBtn && internetSettingsModal) {
    openSettingsBtn.addEventListener('click', () => {
      if (cfgSignalingUrl) cfgSignalingUrl.value = localStorage.getItem('syncwave_signaling_url') || '';
      if (cfgTurnUrl) cfgTurnUrl.value = localStorage.getItem('syncwave_turn_url') || '';
      internetSettingsModal.classList.remove('hidden');
    });
  }

  if (closeSettingsBtn && internetSettingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      internetSettingsModal.classList.add('hidden');
    });
  }

  if (saveSettingsBtn && internetSettingsModal) {
    saveSettingsBtn.addEventListener('click', () => {
      if (cfgSignalingUrl) localStorage.setItem('syncwave_signaling_url', cfgSignalingUrl.value.trim());
      if (cfgTurnUrl) localStorage.setItem('syncwave_turn_url', cfgTurnUrl.value.trim());
      internetSettingsModal.classList.add('hidden');
    });
  }

  if (regenTokenBtn) {
    regenTokenBtn.addEventListener('click', async () => {
      regenTokenBtn.disabled = true;
      if (activeMode === 'local') {
        const res = await window.syncwaveAPI.regenerateToken();
        if (res && res.success) {
          localBroadcastingState = res;
          applyBroadcastingState(res);
        }
      } else {
        const res = await window.syncwaveAPI.regenerateInternetToken();
        if (res && res.success) {
          internetBroadcastingState = res;
          applyBroadcastingState(res);
        }
      }
      setTimeout(() => {
        regenTokenBtn.disabled = false;
      }, 1000);
    });
  }

  // Start Sync Button (supports both Local Network Mode and Internet Mode)
  startSyncBtn.addEventListener('click', async () => {
    startSyncBtn.disabled = true;
    startSyncBtn.classList.add('loading');
    startSyncBtn.querySelector('span').textContent = 'Starting Broadcast...';

    if (activeMode === 'local') {
      const res = await window.syncwaveAPI.startSync();
      startSyncBtn.classList.remove('loading');

      if (res && res.success) {
        localBroadcastingState = res;
        applyBroadcastingState(res);
      } else {
        startSyncBtn.disabled = false;
        startSyncBtn.querySelector('span').textContent = 'Start Sync Broadcast';
        alert('Failed to start local sync server: ' + (res.error || 'Unknown error'));
      }
    } else {
      const signalingUrl = localStorage.getItem('syncwave_signaling_url') || '';
      const turnUrl = localStorage.getItem('syncwave_turn_url') || '';
      const res = await window.syncwaveAPI.startInternetSync({
        signalingUrl: signalingUrl || undefined,
        customPublicUrl: signalingUrl || undefined,
        customTurn: turnUrl ? { turnUrl } : undefined
      });
      startSyncBtn.classList.remove('loading');

      if (res && res.success) {
        internetBroadcastingState = res;
        applyBroadcastingState(res);
      } else {
        startSyncBtn.disabled = false;
        startSyncBtn.querySelector('span').textContent = 'Start Internet Broadcast';
        alert('Failed to start Internet Mode: ' + (res.error || 'Unknown error'));
      }
    }
  });

  // Stop Sync Button
  stopSyncBtn.addEventListener('click', async () => {
    stopSyncBtn.disabled = true;
    if (activeMode === 'local') {
      await window.syncwaveAPI.stopSync();
      localBroadcastingState = null;
    } else {
      await window.syncwaveAPI.stopInternetSync();
      internetBroadcastingState = null;
    }
    applyIdleState();
  });

  // Copy Link Button
  copyUrlBtn.addEventListener('click', async () => {
    const url = connectionUrlInput.value;
    if (url && !url.includes('Start sync')) {
      await window.syncwaveAPI.copyToClipboard(url);
      copyBtnText.textContent = 'Copied!';
      copyUrlBtn.classList.add('copied');
      setTimeout(() => {
        copyBtnText.textContent = 'Copy';
        copyUrlBtn.classList.remove('copied');
      }, 2000);
    }
  });

  // Device Approval Handlers
  approveDeviceBtn.addEventListener('click', async () => {
    if (!currentPendingRequest) return;
    const deviceId = currentPendingRequest.deviceId;
    approvalModalBackdrop.classList.add('hidden');
    currentPendingRequest = null;

    await window.syncwaveAPI.approveDevice(deviceId);
  });

  rejectDeviceBtn.addEventListener('click', async () => {
    if (!currentPendingRequest) return;
    const deviceId = currentPendingRequest.deviceId;
    approvalModalBackdrop.classList.add('hidden');
    currentPendingRequest = null;

    await window.syncwaveAPI.rejectDevice(deviceId, 'Host rejected request');
  });

  // Event Listeners from Preload
  window.syncwaveAPI.onDeviceRequest((req) => {
    currentPendingRequest = req;
    reqDeviceName.textContent = req.name;
    reqDeviceIP.textContent = req.ip;
    reqDeviceType.textContent = req.type;
    if (reqDeviceMode) {
      reqDeviceMode.textContent = (req.mode === 'internet' ? 'Internet (Remote/Cellular)' : 'Local Wi-Fi');
    }
    approvalModalBackdrop.classList.remove('hidden');
  });

  window.syncwaveAPI.onDeviceApproved((dev) => {
    console.log('Device approved:', dev);
  });

  window.syncwaveAPI.onDevicesUpdated((devices) => {
    activeDevices = devices || [];
    renderDeviceCards(activeDevices);
  });

  window.syncwaveAPI.onStatusChanged((status) => {
    if (status.isBroadcasting) {
      if (status.mode === 'internet') {
        internetBroadcastingState = status;
      } else {
        localBroadcastingState = status;
      }
      applyBroadcastingState(status);
    } else {
      if (status.mode === 'internet') {
        internetBroadcastingState = null;
      } else {
        localBroadcastingState = null;
      }
      applyIdleState();
    }
  });

  window.syncwaveAPI.onAudioVisualizerData((data) => {
    visualizer.updateAudioData(data);
  });

  // Check initial state on app launch
  const initialStatus = await window.syncwaveAPI.getStatus();
  if (initialStatus && initialStatus.isRunning) {
    localBroadcastingState = initialStatus;
    applyBroadcastingState(initialStatus);
  } else {
    applyIdleState();
  }

  function switchMode(newMode) {
    activeMode = newMode;
    const isLocal = activeMode === 'local';

    if (modeLocalBtn) modeLocalBtn.classList.toggle('active', isLocal);
    if (modeInternetBtn) modeInternetBtn.classList.toggle('active', !isLocal);

    if (isLocal) {
      if (connectionCardSubtitle) connectionCardSubtitle.textContent = 'Connect phones, tablets & laptops locally';
      if (securityBadgeText) securityBadgeText.textContent = 'Token Auth';
      if (securityNoticeText) securityNoticeText.innerHTML = 'Local Wi-Fi Network Transport &bull; Non-Cloud &bull; Host Approved';
      if (step1Text) step1Text.innerHTML = 'Make sure receiver is on the <strong>same Wi-Fi</strong> network.';
      if (step2Text) step2Text.textContent = 'Scan QR code with iPhone Camera or Android Lens.';
      if (step3Text) step3Text.innerHTML = 'Tap <strong>"Join Stream"</strong> on the phone & approve here.';
      if (connectionUrlLabel) connectionUrlLabel.textContent = 'Local Connection URL:';
      if (qrPlaceholderText) qrPlaceholderText.textContent = 'Click "Start Sync" to generate QR code';

      if (localBroadcastingState && localBroadcastingState.isBroadcasting) {
        showQrAndUrl(localBroadcastingState.qrDataURL, localBroadcastingState.url);
        startSyncBtn.disabled = true;
        startSyncBtn.querySelector('span').textContent = 'Local Broadcast Active';
        stopSyncBtn.disabled = false;
      } else {
        showIdleQr();
        startSyncBtn.disabled = false;
        startSyncBtn.querySelector('span').textContent = 'Start Sync Broadcast';
        stopSyncBtn.disabled = (internetBroadcastingState && internetBroadcastingState.isBroadcasting) ? false : true;
      }
    } else {
      if (connectionCardSubtitle) connectionCardSubtitle.textContent = 'Connect from Jio 5G, Airtel 5G, BSNL or remote networks';
      if (securityBadgeText) securityBadgeText.textContent = 'WebRTC + Token';
      if (securityNoticeText) securityNoticeText.innerHTML = 'Global Internet Transport &bull; WebRTC STUN/TURN &bull; End-to-End Encrypted';
      if (step1Text) step1Text.innerHTML = 'Receiver can use mobile data (Jio, Airtel, BSNL) or any Wi-Fi.';
      if (step2Text) step2Text.textContent = 'Scan QR code or share public link with anyone.';
      if (step3Text) step3Text.innerHTML = 'Tap <strong>"Connect"</strong> on phone & approve on desktop.';
      if (connectionUrlLabel) connectionUrlLabel.textContent = 'Internet Public URL:';
      if (qrPlaceholderText) qrPlaceholderText.textContent = 'Click "Start Sync" to generate Internet QR code';

      if (internetBroadcastingState && internetBroadcastingState.isBroadcasting) {
        showQrAndUrl(internetBroadcastingState.qrDataURL, internetBroadcastingState.url);
        startSyncBtn.disabled = true;
        startSyncBtn.querySelector('span').textContent = 'Internet Broadcast Active';
        stopSyncBtn.disabled = false;
      } else {
        showIdleQr();
        startSyncBtn.disabled = false;
        startSyncBtn.querySelector('span').textContent = 'Start Internet Broadcast';
        stopSyncBtn.disabled = (localBroadcastingState && localBroadcastingState.isBroadcasting) ? false : true;
      }
    }
  }

  function showQrAndUrl(qrUrl, linkUrl) {
    if (qrUrl) {
      qrImage.src = qrUrl;
      qrImage.classList.remove('hidden');
      qrPlaceholder.classList.add('hidden');
    }
    if (linkUrl) {
      connectionUrlInput.value = linkUrl;
    }
  }

  function showIdleQr() {
    qrImage.classList.add('hidden');
    qrPlaceholder.classList.remove('hidden');
    connectionUrlInput.value = (activeMode === 'local') ? 'Start sync to view link' : 'Start sync to generate public link';
  }

  function applyBroadcastingState(details) {
    visualizer.setBroadcasting(true);

    const isCurrentModeBroadcast = (details.mode === 'internet' && activeMode === 'internet') ||
      (details.mode !== 'internet' && activeMode === 'local');

    if (isCurrentModeBroadcast) {
      startSyncBtn.disabled = true;
      startSyncBtn.querySelector('span').textContent = details.mode === 'internet' ? 'Internet Broadcast Active' : 'Broadcasting Active';
      stopSyncBtn.disabled = false;

      broadcastStatusPill.className = 'status-pill broadcasting';
      if (details.mode === 'internet') {
        broadcastStatusText.textContent = `Internet Streaming Active (WebRTC P2P/Relay)`;
        headerIPText.textContent = 'Global WebRTC';
      } else {
        broadcastStatusText.textContent = `Broadcasting on ${details.localIP}:${details.port}`;
        headerIPText.textContent = details.localIP;
      }

      showQrAndUrl(details.qrDataURL, details.url);
    }

    if (details.capture && details.capture.deviceName && captureEngineName) {
      captureEngineName.textContent = `${details.capture.deviceName} (Loopback Active)`;
      if (audioCaptureBadge) audioCaptureBadge.className = 'audio-capture-badge active';
    }

    renderDeviceCards(details.activeDevices || activeDevices);
  }

  function applyIdleState() {
    const anyBroadcasting = (localBroadcastingState && localBroadcastingState.isBroadcasting) ||
      (internetBroadcastingState && internetBroadcastingState.isBroadcasting);

    if (!anyBroadcasting) {
      visualizer.setBroadcasting(false);
      broadcastStatusPill.className = 'status-pill idle';
      broadcastStatusText.textContent = 'Idle (Server Stopped)';

      if (captureEngineName) {
        captureEngineName.textContent = 'WASAPI Loopback Ready';
        if (audioCaptureBadge) audioCaptureBadge.className = 'audio-capture-badge';
      }
    }

    startSyncBtn.disabled = false;
    startSyncBtn.querySelector('span').textContent = activeMode === 'internet' ? 'Start Internet Broadcast' : 'Start Sync Broadcast';
    stopSyncBtn.disabled = !anyBroadcasting;

    showIdleQr();
    renderDeviceCards(anyBroadcasting ? activeDevices : []);
  }

  function renderDeviceCards(devices) {
    const devList = devices || [];
    deviceCountVal.textContent = devList.length;

    // Prune removed devices from deviceMuteStates
    const currentDeviceIds = new Set(devList.map(d => d.deviceId));
    for (const id of deviceMuteStates.keys()) {
      if (!currentDeviceIds.has(id)) {
        deviceMuteStates.delete(id);
      }
    }

    if (devList.length === 0) {
      deviceListContainer.innerHTML = `
        <div class="empty-devices-view" id="emptyDevicesView">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
              <line x1="12" y1="18" x2="12.01" y2="18"/>
            </svg>
          </div>
          <h3>No Devices Connected</h3>
          <p>Start Sync and scan the QR code from another device to begin synchronized streaming.</p>
        </div>
      `;
      return;
    }

    let gridHtml = '<div class="device-cards-grid">';
    devList.forEach((dev) => {
      // Sensible fallbacks for device information
      const name = (dev.name && dev.name.trim()) || 'Unknown Device';
      const type = (dev.type && dev.type.trim()) || 'Web Receiver';
      const ip = dev.ip || 'Local Network';
      const status = dev.status || 'connected';
      const isConnected = status === 'connected';
      const latencyDisplay = dev.latencyMs ? `${dev.latencyMs} ms` : '< 15 ms';

      // Individual Mute & Volume State
      const rawVol = dev.volume !== undefined ? dev.volume : 1.0;
      let muteInfo = deviceMuteStates.get(dev.deviceId);
      if (!muteInfo) {
        muteInfo = {
          isMuted: rawVol === 0,
          unmutedVolume: rawVol > 0 ? rawVol : 1.0
        };
        deviceMuteStates.set(dev.deviceId, muteInfo);
      }

      const isMuted = muteInfo.isMuted;
      const displayVol = isMuted ? 0 : Math.round((muteInfo.unmutedVolume || rawVol || 1.0) * 100);

      gridHtml += `
        <div class="device-card ${isConnected ? '' : 'disconnected'}" data-device-id="${dev.deviceId}">
          <div class="dev-card-top">
            <div class="dev-info-left">
              <div class="dev-avatar ${getDeviceTypeClass(type)}">
                ${getDeviceSvg(type)}
              </div>
              <div class="dev-title-block">
                <div class="dev-name-row">
                  <span class="dev-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                  <span class="dev-status-pill ${isConnected ? 'connected' : 'disconnected'}">
                    <span class="dev-status-dot"></span>
                    ${isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
                <div class="dev-badges-row">
                  <span class="dev-mode-pill ${dev.mode === 'internet' ? 'mode-internet' : 'mode-local'}">${dev.mode === 'internet' ? 'Internet' : 'Local Wi-Fi'}</span>
                  <span class="dev-type-badge">${escapeHtml(type)}</span>
                  <span class="dev-meta-pill" title="IP Address">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="2" y1="12" x2="22" y2="12"/>
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                    <span>${escapeHtml(ip)}</span>
                  </span>
                  <span class="dev-meta-pill" title="Audio Synchronization Latency">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                    <span>${escapeHtml(latencyDisplay)}</span>
                  </span>
                </div>
              </div>
            </div>
            <button class="btn-dev-disconnect" data-id="${dev.deviceId}" title="Disconnect ${escapeHtml(name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              <span>Disconnect</span>
            </button>
          </div>

          <div class="dev-card-controls">
            <button class="btn-dev-mute ${isMuted ? 'muted' : ''}" data-id="${dev.deviceId}" title="${isMuted ? 'Unmute' : 'Mute'}">
              ${getMuteSvg(isMuted)}
            </button>
            <div class="dev-slider-wrapper">
              <input type="range" class="custom-slider dev-vol-slider" min="0" max="100" value="${displayVol}" data-id="${dev.deviceId}">
            </div>
            <span class="dev-vol-percent ${isMuted ? 'muted-text' : ''}" id="volText-${dev.deviceId}">
              ${isMuted ? 'Muted' : displayVol + '%'}
            </span>
          </div>
        </div>
      `;
    });
    gridHtml += '</div>';

    deviceListContainer.innerHTML = gridHtml;

    // Attach event listeners to Disconnect buttons
    deviceListContainer.querySelectorAll('.btn-dev-disconnect').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const targetBtn = e.currentTarget;
        const id = targetBtn.getAttribute('data-id');
        targetBtn.disabled = true;
        targetBtn.innerHTML = '<span>Disconnecting...</span>';
        await window.syncwaveAPI.disconnectDevice(id, 'Host disconnected device');
      });
    });

    // Attach event listeners to individual Mute/Unmute toggle buttons
    deviceListContainer.querySelectorAll('.btn-dev-mute').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const targetBtn = e.currentTarget;
        const id = targetBtn.getAttribute('data-id');
        const muteInfo = deviceMuteStates.get(id) || { isMuted: false, unmutedVolume: 1.0 };
        const slider = deviceListContainer.querySelector(`.dev-vol-slider[data-id="${id}"]`);
        const textElem = document.getElementById(`volText-${id}`);

        if (muteInfo.isMuted) {
          // Unmute: restore previous unmuted volume
          const restored = muteInfo.unmutedVolume > 0 ? muteInfo.unmutedVolume : 1.0;
          muteInfo.isMuted = false;
          deviceMuteStates.set(id, muteInfo);
          targetBtn.classList.remove('muted');
          targetBtn.innerHTML = getMuteSvg(false);
          targetBtn.title = 'Mute';
          if (slider) slider.value = Math.round(restored * 100);
          if (textElem) {
            textElem.textContent = `${Math.round(restored * 100)}%`;
            textElem.classList.remove('muted-text');
          }
          await window.syncwaveAPI.setDeviceVolume(id, restored);
        } else {
          // Mute: save current slider value and set volume to 0
          const currentSliderVal = slider ? parseInt(slider.value, 10) / 100 : 1.0;
          if (currentSliderVal > 0) {
            muteInfo.unmutedVolume = currentSliderVal;
          }
          muteInfo.isMuted = true;
          deviceMuteStates.set(id, muteInfo);
          targetBtn.classList.add('muted');
          targetBtn.innerHTML = getMuteSvg(true);
          targetBtn.title = 'Unmute';
          if (slider) slider.value = 0;
          if (textElem) {
            textElem.textContent = 'Muted';
            textElem.classList.add('muted-text');
          }
          await window.syncwaveAPI.setDeviceVolume(id, 0);
        }
      });
    });

    // Attach event listeners to individual Volume Sliders
    deviceListContainer.querySelectorAll('.dev-vol-slider').forEach((slider) => {
      slider.addEventListener('input', async (e) => {
        const id = e.target.getAttribute('data-id');
        const val = parseInt(e.target.value, 10);
        const textElem = document.getElementById(`volText-${id}`);
        const muteBtn = deviceListContainer.querySelector(`.btn-dev-mute[data-id="${id}"]`);
        const muteInfo = deviceMuteStates.get(id) || { isMuted: false, unmutedVolume: 1.0 };

        if (val === 0) {
          muteInfo.isMuted = true;
          if (textElem) {
            textElem.textContent = 'Muted';
            textElem.classList.add('muted-text');
          }
          if (muteBtn) {
            muteBtn.classList.add('muted');
            muteBtn.innerHTML = getMuteSvg(true);
            muteBtn.title = 'Unmute';
          }
        } else {
          muteInfo.isMuted = false;
          muteInfo.unmutedVolume = val / 100;
          if (textElem) {
            textElem.textContent = `${val}%`;
            textElem.classList.remove('muted-text');
          }
          if (muteBtn) {
            muteBtn.classList.remove('muted');
            muteBtn.innerHTML = getMuteSvg(false);
            muteBtn.title = 'Mute';
          }
        }
        deviceMuteStates.set(id, muteInfo);
        await window.syncwaveAPI.setDeviceVolume(id, val / 100);
      });
    });
  }

  function getDeviceTypeClass(type) {
    const s = (type || '').toLowerCase();
    if (s.includes('iphone') || s.includes('ios') || s.includes('ipad') || s.includes('mac')) return 'type-apple';
    if (s.includes('android')) return 'type-android';
    if (s.includes('windows') || s.includes('pc')) return 'type-pc';
    return 'type-web';
  }

  function getDeviceSvg(type) {
    const s = (type || '').toLowerCase();
    if (s.includes('iphone') || s.includes('ios')) {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="3"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`;
    }
    if (s.includes('android') && (s.includes('phone') || !s.includes('tablet'))) {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="18" r="1"/></svg>`;
    }
    if (s.includes('tablet') || s.includes('ipad')) {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`;
    }
    if (s.includes('windows') || s.includes('pc') || s.includes('desktop')) {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
    }
    if (s.includes('mac') || s.includes('laptop')) {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  }

  function getMuteSvg(isMuted) {
    if (isMuted) {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, (tag) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
});
