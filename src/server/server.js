const http = require('http');
const path = require('path');
const express = require('express');
const WebSocket = require('ws');
const { getLocalNetworkInfo } = require('./network');
const { generateQRCodeDataURL } = require('./qr');
const { isLocalNetworkIP, ConnectionRateLimiter, validateClientMessage } = require('./security');
const DeviceManager = require('./deviceManager');
const SyncEngine = require('./syncEngine');

const fs = require('fs');

function resolveReceiverPath() {
  const devPath = path.join(__dirname, '..', '..', 'public', 'receiver');
  if (fs.existsSync(devPath)) return devPath;

  if (process.resourcesPath) {
    const prodPath = path.join(process.resourcesPath, 'public', 'receiver');
    if (fs.existsSync(prodPath)) return prodPath;
  }
  return devPath;
}

class SyncWaveServer {
  constructor(options = {}) {
    this.port = options.port || 3210;
    this.deviceManager = new DeviceManager();
    this.syncEngine = new SyncEngine({ playoutDelayMs: options.playoutDelayMs || 80 });
    this.rateLimiter = new ConnectionRateLimiter({ maxAttempts: 15, windowMs: 10000 });

    this.app = express();
    this.httpServer = null;
    this.wss = null;
    this.isRunning = false;
    this.localIP = '127.0.0.1';
    this.qrDataURL = null;

    // Master volume & mute controls
    this.masterVolume = 1.0;
    this.isMuted = false;

    this.setupExpress();
  }

  setupExpress() {
    // 1. Security Boundary: Restrict HTTP access to local network only
    this.app.use((req, res, next) => {
      const clientIP = req.socket.remoteAddress || '';
      if (!isLocalNetworkIP(clientIP)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'SyncWave is restricted to the local Wi-Fi network.'
        });
      }
      next();
    });

    // 2. Serve static receiver files from public/receiver (supporting packaged paths)
    const receiverPath = resolveReceiverPath();
    this.app.use(express.static(receiverPath));

    // Fallback route for receiver client
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(receiverPath, 'index.html'));
    });

    // API to verify session token and get receiver configuration
    this.app.get('/api/info', (req, res) => {
      const token = req.query.token;
      const isValidToken = this.deviceManager.validateToken(token);

      res.json({
        appName: 'SyncWave',
        version: '1.0.0',
        tokenValid: isValidToken,
        serverTime: Date.now(),
        playoutDelayMs: this.syncEngine.getPlayoutDelay(),
        transport: 'HTTP/WS (Local Wi-Fi)',
        isEncrypted: false,
        securityNote: 'Protected by local network boundary, cryptographic token, and host approval gate.'
      });
    });
  }

  async start() {
    if (this.isRunning) return this.getConnectionDetails();

    const netInfo = getLocalNetworkInfo();
    this.localIP = netInfo.primaryIP;

    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(this.app);

      // Attach WebSocket server with security validation in verifyClient
      this.wss = new WebSocket.Server({
        server: this.httpServer,
        path: '/ws',
        maxPayload: 8192, // Max 8KB control frame to prevent buffer flooding
        verifyClient: (info, callback) => {
          try {
            const clientIP = info.req.socket.remoteAddress || '';

            // Check 1: Must be local network IP
            if (!isLocalNetworkIP(clientIP)) {
              return callback(false, 403, 'Forbidden: External access not permitted');
            }

            // Check 2: Rate limiting against connection flooding
            if (this.rateLimiter.isRateLimited(clientIP)) {
              return callback(false, 429, 'Too Many Requests: Rate limit exceeded');
            }

            // Check 3: Session token verification
            const url = new URL(info.req.url, `http://${info.req.headers.host}`);
            const token = url.searchParams.get('token');
            if (this.deviceManager.validateToken(token)) {
              callback(true);
            } else {
              callback(false, 401, 'Unauthorized: Invalid or expired connection token');
            }
          } catch (err) {
            callback(false, 400, 'Bad Request');
          }
        }
      });

      this.setupWebSocket();

      this.httpServer.listen(this.port, '0.0.0.0', async (err) => {
        if (err) {
          this.isRunning = false;
          return reject(err);
        }

        this.isRunning = true;
        const details = await this.updateConnectionDetails();
        resolve(details);
      });

      this.httpServer.on('error', (err) => {
        if (!this.isRunning) reject(err);
      });
    });
  }

  async updateConnectionDetails() {
    const token = this.deviceManager.getSessionToken();
    const url = `http://${this.localIP}:${this.port}?token=${token}`;
    this.qrDataURL = await generateQRCodeDataURL(url);

    return {
      localIP: this.localIP,
      port: this.port,
      token,
      url,
      qrDataURL: this.qrDataURL,
      activeDevices: this.deviceManager.getAllDevicesSummary(),
      masterVolume: this.masterVolume,
      isMuted: this.isMuted,
      transport: 'HTTP/WS (Local Wi-Fi)',
      isEncrypted: false,
      securityNote: 'Protected by local network boundary, cryptographic token, and host approval gate.'
    };
  }

  setupWebSocket() {
    this.wss.on('connection', (socket, req) => {
      const clientIP = req.socket.remoteAddress.replace(/^.*:/, '') || 'Unknown';

      // Enforce message length & schema validation
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          // Receivers do not send binary upstream
          return;
        }

        // Prevent oversized text messages
        if (data.length > 8192) {
          socket.close(1009, 'Message exceeds 8KB limit');
          return;
        }

        try {
          const msg = JSON.parse(data.toString());
          const validation = validateClientMessage(msg);

          if (!validation.valid) {
            socket.send(JSON.stringify({
              type: 'error',
              code: 'INVALID_MESSAGE',
              message: validation.error
            }));
            return;
          }

          this.handleClientMessage(socket, clientIP, msg);
        } catch (err) {
          console.error('Failed to parse client message:', err);
        }
      });

      socket.on('close', () => {
        this.deviceManager.handleSocketClosed(socket);
      });

      socket.on('error', (err) => {
        console.error('Socket error for client ' + clientIP, err);
        this.deviceManager.handleSocketClosed(socket);
      });
    });
  }

  handleClientMessage(socket, clientIP, msg) {
    const now = Date.now();

    switch (msg.type) {
      case 'join-request': {
        const result = this.deviceManager.handleConnectionRequest(socket, clientIP, {
          deviceId: msg.deviceId,
          name: msg.name,
          userAgent: msg.userAgent
        });

        if (result.status === 'pending') {
          socket.send(JSON.stringify({
            type: 'approval-pending',
            deviceId: result.request.deviceId,
            message: 'Waiting for desktop host approval...'
          }));
        }
        break;
      }

      case 'sync-ping': {
        const t0 = msg.clientSendTime;
        const t1 = now;
        const response = this.syncEngine.createSyncResponse(t0, t1);
        socket.send(JSON.stringify(response));
        break;
      }

      case 'latency-report': {
        if (msg.deviceId && typeof msg.latencyMs === 'number') {
          this.deviceManager.updateDeviceLatency(msg.deviceId, msg.latencyMs);
        }
        break;
      }

      case 'ping': {
        socket.send(JSON.stringify({ type: 'pong', serverTime: now }));
        break;
      }

      default:
        break;
    }
  }

  /**
   * Broadcasts a PCM audio buffer to all approved receiver devices.
   * Applies master volume and mute scaling.
   * Encodes a unified binary frame:
   * [4 bytes uint32BE: headerLength] [headerLength bytes UTF-8 JSON] [raw audio data]
   */
  broadcastAudio(pcmBuffer, format = { sampleRate: 48000, channels: 2, bitDepth: 16 }) {
    if (!this.isRunning || !pcmBuffer || pcmBuffer.length === 0) return;

    const approvedSockets = this.deviceManager.getApprovedSockets();
    if (approvedSockets.length === 0) return;

    // Apply Master Volume & Mute to PCM buffer
    let processedBuffer = pcmBuffer;

    if (this.isMuted) {
      processedBuffer = Buffer.alloc(pcmBuffer.length, 0); // silence
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

    // Create single compound binary frame
    const packetLength = 4 + headerBuffer.length + buffer.length;
    const packet = Buffer.allocUnsafe(packetLength);

    packet.writeUInt32BE(headerBuffer.length, 0);
    headerBuffer.copy(packet, 4);
    buffer.copy(packet, 4 + headerBuffer.length);

    // Send to each approved client
    for (const client of approvedSockets) {
      try {
        if (client.readyState === WebSocket.OPEN) {
          // Backpressure check: avoid queueing if socket buffer is too high
          if (client.bufferedAmount < 512 * 1024) {
            client.send(packet, { binary: true });
          }
        }
      } catch (err) {
        console.error('Error broadcasting audio packet to client:', err);
      }
    }
  }

  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  setMute(isMuted) {
    this.isMuted = !!isMuted;
  }

  approveDevice(deviceId) {
    return this.deviceManager.approveDevice(deviceId);
  }

  rejectDevice(deviceId, reason) {
    return this.deviceManager.rejectDevice(deviceId, reason);
  }

  disconnectDevice(deviceId, reason) {
    return this.deviceManager.disconnectDevice(deviceId, reason);
  }

  setDeviceVolume(deviceId, volume) {
    return this.deviceManager.setDeviceVolume(deviceId, volume);
  }

  async regenerateSession() {
    this.deviceManager.resetSessionToken();
    return await this.updateConnectionDetails();
  }

  async stop() {
    if (!this.isRunning) return;

    return new Promise((resolve) => {
      if (this.wss) {
        // Terminate any remaining open client sockets to prevent hanging
        for (const client of this.wss.clients) {
          try {
            client.terminate();
          } catch (e) {}
        }

        this.wss.close(() => {
          if (this.httpServer) {
            this.httpServer.close(() => {
              this.isRunning = false;
              resolve();
            });
          } else {
            this.isRunning = false;
            resolve();
          }
        });
      } else {
        this.isRunning = false;
        resolve();
      }
    });
  }

  getConnectionDetails() {
    const token = this.deviceManager.getSessionToken();
    const url = `http://${this.localIP}:${this.port}?token=${token}`;
    return {
      localIP: this.localIP,
      port: this.port,
      token,
      url,
      qrDataURL: this.qrDataURL,
      activeDevices: this.deviceManager.getAllDevicesSummary(),
      masterVolume: this.masterVolume,
      isMuted: this.isMuted,
      isRunning: this.isRunning,
      transport: 'HTTP/WS (Local Wi-Fi)',
      isEncrypted: false,
      securityNote: 'Protected by local network boundary, cryptographic token, and host approval gate.'
    };
  }
}

module.exports = SyncWaveServer;
