const crypto = require('crypto');
const EventEmitter = require('events');

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    // activeSessionToken for the current sync session
    this.sessionToken = this.generateToken();
    
    // Map of deviceId -> Device object
    this.devices = new Map();
    
    // Map of deviceId -> Pending request object
    this.pendingRequests = new Map();
  }

  generateToken() {
    return crypto.randomBytes(12).toString('hex');
  }

  resetSessionToken() {
    this.sessionToken = this.generateToken();
    return this.sessionToken;
  }

  getSessionToken() {
    return this.sessionToken;
  }

  validateToken(token) {
    return token && token === this.sessionToken;
  }

  /**
   * Registers an incoming device connection request.
   * If already approved, re-attaches the socket.
   */
  handleConnectionRequest(socket, ip, deviceInfo = {}) {
    const deviceId = deviceInfo.deviceId || crypto.randomUUID();
    const existing = this.devices.get(deviceId);

    // If device was previously approved in this session, auto-reconnect seamlessly
    if (existing && existing.approved) {
      existing.socket = socket;
      existing.connectedAt = Date.now();
      existing.ip = ip;
      existing.lastPing = Date.now();
      existing.status = 'connected';

      // Notify reconnected device immediately
      if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({
          type: 'approval-response',
          approved: true,
          deviceId: existing.deviceId,
          serverTime: Date.now()
        }));
      }

      this.emit('device-reconnected', existing);
      this.emit('devices-updated', this.getAllDevicesSummary());
      return { status: 'approved', device: existing };
    }

    const deviceName = deviceInfo.name || this.guessDeviceName(deviceInfo.userAgent, ip);
    const deviceType = this.guessDeviceType(deviceInfo.userAgent);

    const request = {
      deviceId,
      name: deviceName,
      type: deviceType,
      ip,
      userAgent: deviceInfo.userAgent || '',
      requestedAt: Date.now(),
      socket
    };

    this.pendingRequests.set(deviceId, request);
    this.emit('device-request', {
      deviceId: request.deviceId,
      name: request.name,
      type: request.type,
      ip: request.ip,
      requestedAt: request.requestedAt
    });

    return { status: 'pending', request };
  }

  /**
   * Approves a pending device request.
   */
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
      volume: 1.0,
      latencyMs: 0,
      approved: true,
      status: 'connected',
      connectedAt: Date.now(),
      lastPing: Date.now(),
      socket: pending.socket
    };

    this.devices.set(deviceId, device);

    // Notify device via its socket
    if (device.socket && device.socket.readyState === 1 /* OPEN */) {
      device.socket.send(JSON.stringify({
        type: 'approval-response',
        approved: true,
        deviceId: device.deviceId,
        serverTime: Date.now()
      }));
    }

    this.emit('device-approved', this.getDeviceSummary(device));
    this.emit('devices-updated', this.getAllDevicesSummary());
    return device;
  }

  /**
   * Rejects a pending device request.
   */
  rejectDevice(deviceId, reason = 'Connection rejected by host') {
    const pending = this.pendingRequests.get(deviceId);
    if (!pending) return false;

    this.pendingRequests.delete(deviceId);

    if (pending.socket && pending.socket.readyState === 1) {
      pending.socket.send(JSON.stringify({
        type: 'approval-response',
        approved: false,
        reason
      }));
      pending.socket.close(1008, reason);
    }

    this.emit('device-rejected', { deviceId, reason });
    return true;
  }

  /**
   * Disconnects an approved device.
   */
  disconnectDevice(deviceId, reason = 'Disconnected by host') {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    if (device.socket && device.socket.readyState === 1) {
      device.socket.send(JSON.stringify({
        type: 'disconnect',
        reason
      }));
      device.socket.close(1000, reason);
    }

    this.devices.delete(deviceId);
    this.emit('device-disconnected', { deviceId, reason });
    this.emit('devices-updated', this.getAllDevicesSummary());
    return true;
  }

  /**
   * Sets individual device volume (0.0 to 1.0)
   */
  setDeviceVolume(deviceId, volume) {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    device.volume = Math.max(0, Math.min(1, volume));
    if (device.socket && device.socket.readyState === 1) {
      device.socket.send(JSON.stringify({
        type: 'volume-change',
        volume: device.volume
      }));
    }

    this.emit('device-volume-changed', { deviceId, volume: device.volume });
    return true;
  }

  /**
   * Updates measured latency / RTT for a device
   */
  updateDeviceLatency(deviceId, latencyMs) {
    const device = this.devices.get(deviceId);
    if (device) {
      device.latencyMs = latencyMs;
      device.lastPing = Date.now();
    }
  }

  /**
   * Handles device socket closure. Retains approved device profile
   * for a 60-second grace period to allow automatic seamless reconnection.
   */
  handleSocketClosed(socket) {
    for (const [id, dev] of this.devices.entries()) {
      if (dev.socket === socket) {
        dev.status = 'disconnected';
        dev.socket = null;
        this.emit('device-disconnected', { deviceId: id, reason: 'Socket closed' });

        // Retain approved profile for 60 seconds to allow seamless reconnection without re-prompting host
        setTimeout(() => {
          if (dev.status === 'disconnected') {
            this.devices.delete(id);
            this.emit('devices-updated', this.getAllDevicesSummary());
          }
        }, 60000);

        this.emit('devices-updated', this.getAllDevicesSummary());
        break;
      }
    }
    for (const [id, req] of this.pendingRequests.entries()) {
      if (req.socket === socket) {
        this.pendingRequests.delete(id);
        this.emit('device-request-cancelled', { deviceId: id });
        break;
      }
    }
  }

  getDeviceSummary(device) {
    return {
      deviceId: device.deviceId,
      name: device.name,
      type: device.type,
      ip: device.ip,
      volume: device.volume,
      latencyMs: device.latencyMs,
      status: device.status,
      connectedAt: device.connectedAt
    };
  }

  getAllDevicesSummary() {
    return Array.from(this.devices.values()).map(d => this.getDeviceSummary(d));
  }

  getApprovedSockets() {
    return Array.from(this.devices.values())
      .filter(d => d.approved && d.socket && d.socket.readyState === 1)
      .map(d => d.socket);
  }

  guessDeviceType(ua = '') {
    const s = ua.toLowerCase();
    if (/iphone|ipod/.test(s)) return 'iPhone';
    if (/ipad/.test(s)) return 'iPad';
    if (/android.*mobile/.test(s)) return 'Android Phone';
    if (/android/.test(s)) return 'Android Tablet';
    if (/macintosh|mac os/.test(s)) return 'Mac';
    if (/windows/.test(s)) return 'Windows PC';
    if (/linux/.test(s)) return 'Linux';
    return 'Web Receiver';
  }

  guessDeviceName(ua = '', ip = '') {
    const type = this.guessDeviceType(ua);
    const shortIp = ip.split('.').slice(-2).join('.');
    return `${type} (${shortIp || 'Local'})`;
  }
}

module.exports = DeviceManager;
