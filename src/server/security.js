/**
 * SyncWave Security & Network Protection Module
 * Handles local IP boundary verification, connection rate limiting,
 * and message schema validation.
 */

// Private IP Ranges (RFC 1918 & Loopback)
const PRIVATE_IPV4_REGEX = /^(::f{4}:)?(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$/;

/**
 * Checks whether an IP address belongs to the local private network.
 * Protects against public internet exposure.
 */
function isLocalNetworkIP(ip) {
  if (!ip) return false;
  const cleanIp = ip.trim().replace(/^.*:/, ''); // strip IPv6 prefix if IPv4 mapped
  if (cleanIp === '1' || cleanIp === 'localhost') return true;
  return PRIVATE_IPV4_REGEX.test(ip) || PRIVATE_IPV4_REGEX.test(cleanIp);
}

/**
 * In-memory connection rate limiter to prevent connection flooding.
 */
class ConnectionRateLimiter {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts || 10;
    this.windowMs = options.windowMs || 10000; // 10 seconds
    this.ipHistory = new Map();
  }

  isRateLimited(ip) {
    const now = Date.now();
    const history = this.ipHistory.get(ip) || [];

    // Filter out attempts outside the current window
    const recentAttempts = history.filter(time => now - time < this.windowMs);

    if (recentAttempts.length >= this.maxAttempts) {
      return true;
    }

    recentAttempts.push(now);
    this.ipHistory.set(ip, recentAttempts);

    // Periodic cleanup of stale IPs
    if (this.ipHistory.size > 200) {
      for (const [key, timestamps] of this.ipHistory.entries()) {
        if (timestamps.every(t => now - t >= this.windowMs)) {
          this.ipHistory.delete(key);
        }
      }
    }

    return false;
  }

  reset() {
    this.ipHistory.clear();
  }
}

const ALLOWED_MESSAGE_TYPES = new Set([
  'join-request',
  'sync-ping',
  'latency-report',
  'ping'
]);

/**
 * Validates incoming client WebSocket message against schema and bounds.
 * Prevents prototype pollution and malformed payloads.
 */
function validateClientMessage(rawMsg) {
  if (!rawMsg || typeof rawMsg !== 'object') {
    return { valid: false, error: 'Message must be a non-null object' };
  }

  if (typeof rawMsg.type !== 'string' || !ALLOWED_MESSAGE_TYPES.has(rawMsg.type)) {
    return { valid: false, error: `Invalid or unrecognized message type: ${rawMsg.type}` };
  }

  if (rawMsg.deviceId !== undefined) {
    if (typeof rawMsg.deviceId !== 'string' || rawMsg.deviceId.length > 64 || !/^[a-zA-Z0-9_\-\.]+$/.test(rawMsg.deviceId)) {
      return { valid: false, error: 'Invalid deviceId format' };
    }
  }

  if (rawMsg.type === 'sync-ping') {
    if (typeof rawMsg.clientSendTime !== 'number' || isNaN(rawMsg.clientSendTime)) {
      return { valid: false, error: 'sync-ping requires valid numeric clientSendTime' };
    }
  }

  if (rawMsg.type === 'latency-report') {
    if (typeof rawMsg.latencyMs !== 'number' || rawMsg.latencyMs < 0 || rawMsg.latencyMs > 10000) {
      return { valid: false, error: 'latency-report requires valid numeric latencyMs' };
    }
  }

  return { valid: true };
}

module.exports = {
  isLocalNetworkIP,
  ConnectionRateLimiter,
  validateClientMessage
};
