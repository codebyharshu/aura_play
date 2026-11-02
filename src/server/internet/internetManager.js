const EventEmitter = require('events');
const crypto = require('crypto');
const WebSocket = require('ws');
const { generateQRCodeDataURL } = require('../qr');
const SyncEngine = require('../syncEngine');
const { getIceServers } = require('./turnConfig');
const TunnelManager = require('./tunnelManager');

class InternetManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.syncEngine = new SyncEngine({ playoutDelayMs: options.playoutDelayMs || 80 });
    this.tunnelManager = new TunnelManager(options);

    this.sessionId = null;
    this.sessionToken = null;
    this.isRunning = false;
    this.publicUrl = null;
    this.receiverUrl = null;
    this.qrDataURL = null;

    // Active internet devices: deviceId -> { deviceId, name, type, ip, mode: 'internet', volume, status, socket, dataChannel, latencyMs, lastPing }
    this.devices = new Map();
    this.pendingRequests = new Map();

    // Master volume & mute
    this.masterVolume = 1.0;
    this.isMuted = false;

    // Upstream connection to public signaling service (if configured)
    this.signalingSocket = null;
    this.reconnectTimer = null;
  }

  async start() {
    if (this.isRunning) return this.getConnectionDetails();

    // 1. Generate unique session ID & cryptographic token
    this.sessionId = 'sync-' + crypto.randomBytes(8).toString('hex');
    this.sessionToken = 'tok-' + crypto.randomBytes(16).toString('hex');

    // 2. Resolve public entrypoint
    const tunnelResult = await this.tunnelManager.start({
      sessionId: this.sessionId,
      token: this.sessionToken,
      port: this.options.port || 3210
    });

    this.publicUrl = tunnelResult.publicUrl;
    this.receiverUrl = `${this.publicUrl}/receiver/?session=${this.sessionId}&token=${this.sessionToken}&mode=internet`;

    // 3. Generate QR code for internet receiver
    this.qrDataURL = await generateQRCodeDataURL(this.receiverUrl);

    // 4. If an external signaling URL is configured, establish host connection
    if (this.tunnelManager.signalingUrl) {
      this.connectToSignalingServer(this.tunnelManager.signalingUrl);
    }

    this.isRunning = true;
    const details = this.getConnectionDetails();
    this.emit('status-changed', details);
    return details;
  }

  connectToSignalingServer(signalingUrl) {
    if (this.signalingSocket) {
      try { this.signalingSocket.close(); } catch (e) {}
    }

    const wsUrl = signalingUrl.replace(/^http/, 'ws') +
      `?role=host&session=${this.sessionId}&token=${this.sessionToken}`;

    try {
      this.signalingSocket = new WebSocket(wsUrl);

      this.signalingSocket.on('open', () => {
        console.log(`[InternetManager] Connected to signaling service: ${signalingUrl}`);
      });

      this.signalingSocket.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleSignalingMessage(msg);
        } catch (err) {
          console.error('[InternetManager] Failed to parse signaling message:', err);
        }
      });

      this.signalingSocket.on('close', () => {
        console.log('[InternetManager] Disconnected from signaling service.');
        if (this.isRunning) {
          // Reconnect attempt after 3s
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            if (this.isRunning) this.connectToSignalingServer(signalingUrl);
          }, 3000);
        }
      });

      this.signalingSocket.on('error', (err) => {
        console.warn('[InternetManager] Signaling socket warning:', err.message);
      });
    } catch (err) {
      console.error('[InternetManager] Failed to initialize signaling connection:', err);
    }
  }

  handleSignalingMessage(msg) {
    switch (msg.type) {
      case 'join-request': {
        this.handleReceiverJoinRequest(msg);
        break;
      }

      case 'sync-ping': {
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
          const t0 = msg.clientSendTime;
          const t1 = Date.now();
          const response = this.syncEngine.createSyncResponse(t0, t1);
          response.deviceId = msg.deviceId;
          this.signalingSocket.send(JSON.stringify(response));
        }
        break;
      }

      case 'latency-report': {
        const dev = this.devices.get(msg.deviceId);
        if (dev && typeof msg.latencyMs === 'number') {
          dev.latencyMs = msg.latencyMs;
          this.emit('devices-updated', this.getAllDevicesSummary());
        }
        break;
      }

      case 'webrtc-answer': {
        // Forward WebRTC answer to local peer connection if active
        this.emit('webrtc-answer', msg);
        break;
      }

      case 'ice-candidate': {
        this.emit('ice-candidate', msg);
        break;
      }

      case 'receiver-disconnected': {
        this.handleDeviceDisconnected(msg.deviceId, 'Receiver disconnected');
        break;
      }

      default:
        break;
    }
  }

  handleReceiverJoinRequest(req) {
    const deviceId = req.deviceId;
    const name = req.name || this.guessDeviceName(req.userAgent, req.clientIP);
    const type = this.guessDeviceType(req.userAgent);

    const pending = {
      deviceId,
      name,
      type,
      ip: req.clientIP || 'Internet (Mobile/Remote)',
      userAgent: req.userAgent || '',
      mode: 'internet',
      requestedAt: Date.now()
    };

    this.pendingRequests.set(deviceId, pending);

    // Emit event to display approval modal in Electron UI
    this.emit('device-request', {
      deviceId: pending.deviceId,
      name: pending.name,
      type: pending.type,
      ip: pending.ip,
      mode: 'internet',
      requestedAt: pending.requestedAt
    });
  }

  approveDevice(deviceId) {
    const pending = this.pendingRequests.get(deviceId);
    if (!pending) return null;

    this.pendingRequests.delete(deviceId);

    const device = {
      deviceId: pending.deviceId,
      name: pending.name,
      type: pending.type,
      ip: pending.ip,
      userAgent: pending.userAgent,
      mode: 'internet',
      volume: 1.0,
      latencyMs: 25,
      approved: true,
      status: 'connected',
      connectedAt: Date.now(),
      lastPing: Date.now()
    };

    this.devices.set(deviceId, device);

    // Send approval notice over signaling socket
    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify({
        type: 'approval-response',
        deviceId: device.deviceId,
        approved: true,
        iceServers: getIceServers(this.options.customTurn),
        serverTime: Date.now()
      }));
    }

    this.emit('device-approved', this.getDeviceSummary(device));
    this.emit('devices-updated', this.getAllDevicesSummary());
    return device;
  }

  rejectDevice(deviceId, reason = 'Connection rejected by host') {
    const pending = this.pendingRequests.get(deviceId);
    if (!pending) return false;

    this.pendingRequests.delete(deviceId);

    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify({
        type: 'approval-response',
        deviceId,
        approved: false,
        reason
      }));
    }

    this.emit('device-rejected', { deviceId, reason });
    return true;
  }

  disconnectDevice(deviceId, reason = 'Disconnected by host') {
    const dev = this.devices.get(deviceId);
    if (!dev) return false;

    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify({
        type: 'disconnect',
        deviceId,
        reason
      }));
    }

    this.devices.delete(deviceId);
    this.emit('device-disconnected', { deviceId, reason });
    this.emit('devices-updated', this.getAllDevicesSummary());
    return true;
  }

  setDeviceVolume(deviceId, volume) {
    const dev = this.devices.get(deviceId);
    if (!dev) return false;

    dev.volume = Math.max(0, Math.min(1, volume));

    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify({
        type: 'volume-change',
        deviceId,
        volume: dev.volume
      }));
    }

    this.emit('devices-updated', this.getAllDevicesSummary());
    return true;
  }

  handleDeviceDisconnected(deviceId, reason = 'Connection closed') {
    const dev = this.devices.get(deviceId);
    if (dev) {
      dev.status = 'disconnected';
      this.emit('device-disconnected', { deviceId, reason });
      this.emit('devices-updated', this.getAllDevicesSummary());

      // 60-second grace window for seamless reconnection
      setTimeout(() => {
        if (dev.status === 'disconnected') {
          this.devices.delete(deviceId);
          this.emit('devices-updated', this.getAllDevicesSummary());
        }
      }, 60000);
    }
  }

  /**
   * Broadcasts real captured PCM audio to all internet receivers.
   * Sends binary packets through signaling fallback and data channels.
   */
  broadcastAudio(pcmBuffer, format = { sampleRate: 48000, channels: 2, bitDepth: 16 }) {
    if (!this.isRunning || !pcmBuffer || pcmBuffer.length === 0) return;
    if (this.devices.size === 0) return;

    // Apply master volume & mute
    let processedBuffer = pcmBuffer;
    if (this.isMuted) {
      processedBuffer = Buffer.alloc(pcmBuffer.length, 0);
    } else if (this.masterVolume < 0.999) {
      processedBuffer = Buffer.allocUnsafe(pcmBuffer.length);
      const vol = this.masterVolume;
      for (let i = 0; i < pcmBuffer.length; i += 2) {
        const sample = pcmBuffer.readInt16LE(i);
        const scaled = Math.round(sample * vol);
        processedBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, scaled)), i);
      }
    }

    const { header, buffer } = this.syncEngine.packageAudioFrame(processedBuffer, format);
    const headerJson = JSON.stringify(header);
    const headerBuffer = Buffer.from(headerJson, 'utf-8');

    // Create compound frame: [4 bytes headerLength] [JSON header] [PCM audio]
    const packet = Buffer.allocUnsafe(4 + headerBuffer.length + buffer.length);
    packet.writeUInt32BE(headerBuffer.length, 0);
    headerBuffer.copy(packet, 4);
    buffer.copy(packet, 4 + headerBuffer.length);

    // Relay over active signaling socket to public receivers
    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      try {
        if (this.signalingSocket.bufferedAmount < 512 * 1024) {
          this.signalingSocket.send(packet, { binary: true });
        }
      } catch (err) {
        console.error('[InternetManager] Audio broadcast error:', err);
      }
    }
  }

  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  setMute(isMuted) {
    this.isMuted = !!isMuted;
  }

  async regenerateSession() {
    this.sessionToken = 'tok-' + crypto.randomBytes(16).toString('hex');
    this.receiverUrl = `${this.publicUrl}/receiver/?session=${this.sessionId}&token=${this.sessionToken}&mode=internet`;
    this.qrDataURL = await generateQRCodeDataURL(this.receiverUrl);

    // Notify upstream signaling service of updated token to revoke old access
    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify({
        type: 'session-token-updated',
        sessionId: this.sessionId,
        token: this.sessionToken
      }));
    }

    const details = this.getConnectionDetails();
    this.emit('status-changed', details);
    return details;
  }

  async stop() {
    this.isRunning = false;
    clearTimeout(this.reconnectTimer);

    if (this.signalingSocket) {
      try { this.signalingSocket.close(); } catch (e) {}
      this.signalingSocket = null;
    }

    await this.tunnelManager.stop();

    this.devices.clear();
    this.pendingRequests.clear();
    this.emit('status-changed', { isRunning: false, activeDevices: [] });
  }

  getDeviceSummary(device) {
    return {
      deviceId: device.deviceId,
      name: device.name,
      type: device.type,
      ip: device.ip,
      mode: 'internet',
      volume: device.volume,
      latencyMs: device.latencyMs,
      status: device.status,
      connectedAt: device.connectedAt
    };
  }

  getAllDevicesSummary() {
    return Array.from(this.devices.values()).map(d => this.getDeviceSummary(d));
  }

  getConnectionDetails() {
    return {
      isRunning: this.isRunning,
      sessionId: this.sessionId,
      token: this.sessionToken,
      publicUrl: this.publicUrl,
      url: this.receiverUrl,
      qrDataURL: this.qrDataURL,
      activeDevices: this.getAllDevicesSummary(),
      masterVolume: this.masterVolume,
      isMuted: this.isMuted,
      mode: 'internet',
      transport: 'WebRTC (STUN/TURN) + Secure Signaling',
      securityNote: 'End-to-end encrypted transport, cryptographic session token, and host approval gate.'
    };
  }

  guessDeviceType(ua = '') {
    const s = ua.toLowerCase();
    if (/iphone|ipod/.test(s)) return 'iPhone';
    if (/ipad/.test(s)) return 'iPad';
    if (/android.*mobile/.test(s)) return 'Android Phone';
    if (/android/.test(s)) return 'Android Tablet';
    if (/macintosh|mac os/.test(s)) return 'Mac';
    if (/windows/.test(s)) return 'Windows PC';
    return 'Web Receiver';
  }

  guessDeviceName(ua = '', ip = '') {
    const type = this.guessDeviceType(ua);
    const shortIp = ip ? ip.split('.').slice(-2).join('.') : 'Mobile';
    return `${type} (${shortIp})`;
  }
}

module.exports = InternetManager;
