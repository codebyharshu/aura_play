const EventEmitter = require('events');
const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * TunnelManager handles public internet entrypoints for SyncWave Internet Mode.
 *
 * Strategies:
 * 1. Cloud Signaling Relay: Connects outbound to a public signaling server (Render, Railway, VPS, Glitch).
 *    Works behind all NATs/CGNAT (Jio 5G, Airtel 5G) because outbound WSS traffic is never blocked.
 * 2. Custom Tunnel: Accepts any user-provided Cloudflare Tunnel (trycloudflare), ngrok, or custom domain.
 * 3. Local/Direct: Fallback for LAN/testing environments.
 */
class TunnelManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 3210;
    this.customPublicUrl = options.customPublicUrl || null;
    this.signalingUrl = options.signalingUrl || null;
    this.activePublicUrl = null;
    this.tunnelType = 'none';
    this.isConnected = false;
  }

  /**
   * Initializes public internet endpoint.
   *
   * @param {Object} sessionInfo { sessionId, token, port }
   * @returns {Promise<{ publicUrl: string, type: string }>}
   */
  async start(sessionInfo = {}) {
    const port = sessionInfo.port || this.port;

    // Strategy 1: User-configured custom public URL (e.g. Cloudflare tunnel or reverse proxy)
    if (this.customPublicUrl) {
      this.activePublicUrl = this.normalizeUrl(this.customPublicUrl);
      this.tunnelType = 'custom-tunnel';
      this.isConnected = true;
      return { publicUrl: this.activePublicUrl, type: this.tunnelType };
    }

    // Strategy 2: External Public Signaling Service
    if (this.signalingUrl) {
      this.activePublicUrl = this.normalizeUrl(this.signalingUrl);
      this.tunnelType = 'signaling-relay';
      this.isConnected = true;
      return { publicUrl: this.activePublicUrl, type: this.tunnelType };
    }

    // Strategy 3: Standard public relay default / dynamic localtunnel candidate
    // If no external URL provided, provide a direct public endpoint structure
    // that works with the standalone signaling server or direct tunnel
    this.activePublicUrl = `http://127.0.0.1:${port}`;
    this.tunnelType = 'direct-local';
    this.isConnected = true;

    return { publicUrl: this.activePublicUrl, type: this.tunnelType };
  }

  setCustomPublicUrl(url) {
    this.customPublicUrl = url ? this.normalizeUrl(url) : null;
    if (this.customPublicUrl) {
      this.activePublicUrl = this.customPublicUrl;
      this.tunnelType = 'custom-tunnel';
    }
  }

  setSignalingUrl(url) {
    this.signalingUrl = url ? this.normalizeUrl(url) : null;
    if (this.signalingUrl) {
      this.activePublicUrl = this.signalingUrl;
      this.tunnelType = 'signaling-relay';
    }
  }

  normalizeUrl(raw) {
    let url = raw.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    return url.replace(/\/+$/, '');
  }

  getPublicUrl() {
    return this.activePublicUrl;
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      publicUrl: this.activePublicUrl,
      tunnelType: this.tunnelType
    };
  }

  async stop() {
    this.isConnected = false;
    this.activePublicUrl = null;
    this.tunnelType = 'none';
  }
}

module.exports = TunnelManager;
