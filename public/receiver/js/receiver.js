document.addEventListener('DOMContentLoaded', () => {
  // UI Screens
  const unlockScreen = document.getElementById('unlockScreen');
  const waitingApprovalScreen = document.getElementById('waitingApprovalScreen');
  const activeStreamScreen = document.getElementById('activeStreamScreen');
  const disconnectedScreen = document.getElementById('disconnectedScreen');

  // Controls & Badges
  const joinStreamBtn = document.getElementById('joinStreamBtn');
  const reconnectBtn = document.getElementById('reconnectBtn');
  const receiverDisconnectBtn = document.getElementById('receiverDisconnectBtn');
  const receiverVolSlider = document.getElementById('receiverVolSlider');
  const receiverVolText = document.getElementById('receiverVolText');

  const connPill = document.getElementById('connPill');
  const connPillText = document.getElementById('connPillText');
  const clientLatencyVal = document.getElementById('clientLatencyVal');
  const clientOffsetVal = document.getElementById('clientOffsetVal');
  const disconnectReasonTitle = document.getElementById('disconnectReasonTitle');
  const disconnectReasonDesc = document.getElementById('disconnectReasonDesc');

  // Audio & Sync
  const audioSync = new AudioSyncManager();
  let socket = null;
  let peerConnection = null;
  let dataChannel = null;
  let syncIntervalId = null;
  let deviceId = localStorage.getItem('syncwave_device_id') || ('dev-' + Math.random().toString(36).substring(2, 9));
  localStorage.setItem('syncwave_device_id', deviceId);

  // Extract session & mode parameters from URL
  const urlParams = new URLSearchParams(window.location.search);
  const sessionToken = urlParams.get('token') || '';
  const sessionId = urlParams.get('session') || '';
  const isInternetMode = (urlParams.get('mode') === 'internet') || !!sessionId;

  // Check browser capability upfront
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || !window.WebSocket) {
    showScreen(disconnectedScreen);
    disconnectReasonTitle.textContent = 'Unsupported Browser';
    disconnectReasonDesc.textContent = 'Your browser lacks Web Audio or WebSocket support. Please open this link in Chrome, Safari, or Edge.';
    joinStreamBtn.disabled = true;
    return;
  }

  // Volume Slider Listener
  receiverVolSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    receiverVolText.textContent = `${val}%`;
    audioSync.setVolume(val / 100);
  });

  // Join Stream Action (Unlocks audio & connects socket)
  joinStreamBtn.addEventListener('click', async () => {
    joinStreamBtn.disabled = true;
    joinStreamBtn.querySelector('span').textContent = 'Activating Audio...';

    try {
      await audioSync.unlockAudio();
      connectWebSocket();
    } catch (err) {
      console.error('Failed to unlock audio:', err);
      alert('Could not start audio context. Please check your browser audio settings.');
      joinStreamBtn.disabled = false;
      joinStreamBtn.querySelector('span').textContent = 'Connect & Start Audio';
    }
  });

  // Reconnect Action
  reconnectBtn.addEventListener('click', async () => {
    reconnectBtn.disabled = true;
    await audioSync.unlockAudio();
    connectWebSocket();
    reconnectBtn.disabled = false;
  });

  // Disconnect Action
  receiverDisconnectBtn.addEventListener('click', () => {
    if (socket) socket.close(1000, 'User disconnected manually');
    showScreen(disconnectedScreen);
    disconnectReasonTitle.textContent = 'Disconnected';
    disconnectReasonDesc.textContent = 'You have disconnected from the SyncWave audio broadcast.';
    updateConnPill('Disconnected', false);
  });

  function connectWebSocket() {
    updateConnPill('Connecting', false);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(sessionToken)}`;
    if (isInternetMode) {
      wsUrl = `${protocol}//${window.location.host}/ws?role=receiver&session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(sessionToken)}&deviceId=${encodeURIComponent(deviceId)}&mode=internet`;
    }

    try {
      socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
    } catch (err) {
      handleDisconnect('Connection Failed', 'Could not open WebSocket to host: ' + err.message);
      return;
    }

    socket.onopen = () => {
      // Send join request with device info
      socket.send(JSON.stringify({
        type: 'join-request',
        deviceId,
        mode: isInternetMode ? 'internet' : 'local',
        userAgent: navigator.userAgent
      }));
    };

    socket.onmessage = (event) => {
      // If binary audio frame
      if (event.data instanceof ArrayBuffer) {
        handleBinaryAudioFrame(event.data);
        return;
      }

      // JSON message
      try {
        const msg = JSON.parse(event.data);
        handleJsonMessage(msg);
      } catch (err) {
        console.error('Failed to parse incoming message:', err);
      }
    };

    socket.onclose = (event) => {
      stopSyncPing();
      if (peerConnection) {
        try { peerConnection.close(); } catch (e) {}
        peerConnection = null;
      }
      const reason = event.reason || 'Host server closed connection.';
      handleDisconnect('Disconnected', reason);
    };

    socket.onerror = (err) => {
      console.error('WebSocket encountered error:', err);
    };
  }

  function handleJsonMessage(msg) {
    switch (msg.type) {
      case 'approval-pending':
        showScreen(waitingApprovalScreen);
        updateConnPill('Pending Approval', false);
        break;

      case 'approval-response':
        if (msg.approved) {
          showScreen(activeStreamScreen);
          updateConnPill(isInternetMode ? 'Live (Internet)' : 'Live Stream', true);
          startSyncPing();

          if (isInternetMode && window.RTCPeerConnection && msg.iceServers) {
            setupWebRtcPeerConnection(msg.iceServers);
          }
        } else {
          handleDisconnect('Rejected', msg.reason || 'The host rejected your connection request.');
        }
        break;

      case 'webrtc-offer':
        if (msg.offer) {
          handleWebRtcOffer(msg.offer);
        }
        break;

      case 'ice-candidate':
        if (peerConnection && msg.candidate) {
          peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
        }
        break;

      case 'sync-pong': {
        const stats = audioSync.handleSyncPong(msg);
        clientLatencyVal.textContent = `${stats.latencyMs} ms`;
        clientOffsetVal.textContent = `${stats.clockOffsetMs > 0 ? '+' : ''}${stats.clockOffsetMs} ms`;

        // Report latency back to host for dashboard display
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'latency-report',
            deviceId,
            latencyMs: stats.latencyMs
          }));
        }
        break;
      }

      case 'volume-change': {
        const vol = Math.round(msg.volume * 100);
        receiverVolSlider.value = vol;
        receiverVolText.textContent = `${vol}%`;
        audioSync.setVolume(msg.volume);
        break;
      }

      case 'disconnect':
        handleDisconnect('Disconnected by Host', msg.reason || 'The desktop host disconnected this device.');
        break;

      case 'error':
        handleDisconnect('Authentication Error', msg.message);
        break;

      default:
        break;
    }
  }

  /**
   * Handles binary audio frame:
   * [4 bytes uint32: headerLength] [N bytes: JSON header] [PCM binary data]
   */
  function handleBinaryAudioFrame(arrayBuffer) {
    if (arrayBuffer.byteLength < 8) return;

    const dataView = new DataView(arrayBuffer);
    const headerLen = dataView.getUint32(0, false); // Big-Endian

    if (arrayBuffer.byteLength < 4 + headerLen) return;

    const headerBytes = new Uint8Array(arrayBuffer, 4, headerLen);
    const headerStr = new TextDecoder('utf-8').decode(headerBytes);
    const header = JSON.parse(headerStr);

    const pcmOffset = 4 + headerLen;
    const pcmBuffer = arrayBuffer.slice(pcmOffset);

    audioSync.scheduleAudioChunk(header, pcmBuffer);
  }

  function startSyncPing() {
    stopSyncPing();
    // Immediate initial ping
    sendSyncPing();
    // Periodic time sync every 3 seconds
    syncIntervalId = setInterval(sendSyncPing, 3000);
  }

  function stopSyncPing() {
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  }

  function sendSyncPing() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'sync-ping',
        clientSendTime: Date.now()
      }));
    }
  }

  function handleDisconnect(title, desc) {
    showScreen(disconnectedScreen);
    disconnectReasonTitle.textContent = title;
    disconnectReasonDesc.textContent = desc;
    updateConnPill('Offline', false);
  }

  function showScreen(screenToShow) {
    [unlockScreen, waitingApprovalScreen, activeStreamScreen, disconnectedScreen].forEach(s => {
      s.classList.add('hidden');
    });
    screenToShow.classList.remove('hidden');
  }

  function setupWebRtcPeerConnection(iceServers) {
    if (!window.RTCPeerConnection) return;
    try {
      peerConnection = new RTCPeerConnection({ iceServers });

      peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        dataChannel.binaryType = 'arraybuffer';
        dataChannel.onmessage = (e) => {
          if (e.data instanceof ArrayBuffer) {
            handleBinaryAudioFrame(e.data);
          }
        };
        dataChannel.onopen = () => {
          console.log('[WebRTC] DataChannel connected: streaming direct peer audio.');
          updateConnPill('Live (WebRTC P2P)', true);
        };
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'ice-candidate',
            deviceId,
            candidate: event.candidate
          }));
        }
      };

      peerConnection.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          updateConnPill('Live (WebRTC)', true);
        } else if (peerConnection.connectionState === 'failed') {
          console.warn('[WebRTC] P2P connection failed, continuing on secure WebSocket tunnel.');
          updateConnPill('Live (Tunnel Relay)', true);
        }
      };
    } catch (err) {
      console.warn('[WebRTC] Failed to initialize RTCPeerConnection:', err);
    }
  }

  async function handleWebRtcOffer(offer) {
    if (!peerConnection) return;
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'webrtc-answer',
          deviceId,
          answer
        }));
      }
    } catch (err) {
      console.error('[WebRTC] Error handling offer:', err);
    }
  }

  function updateConnPill(text, isConnected) {
    connPillText.textContent = text;
    if (isConnected) {
      connPill.className = 'conn-pill connected';
    } else {
      connPill.className = 'conn-pill';
    }
  }
});
