/**
 * SyncWave STUN/TURN Configuration
 * Provides public STUN servers for direct NAT traversal and
 * TURN relay servers for symmetric NATs (Jio 5G, Airtel 5G, BSNL).
 */

const DEFAULT_STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

// OpenRelay public TURN servers (Metered.ca community tier)
const DEFAULT_TURN_SERVERS = [
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

/**
 * Returns an array of RTCIceServer configurations.
 * Merges default STUN/TURN with any user-configured custom TURN server.
 *
 * @param {Object} [customConfig]
 * @param {string} [customConfig.turnUrl] e.g. "turn:my-turn.example.com:3478"
 * @param {string} [customConfig.turnUsername]
 * @param {string} [customConfig.turnCredential]
 * @returns {Array<Object>} RTCIceServer list
 */
function getIceServers(customConfig = {}) {
  const iceServers = [...DEFAULT_STUN_SERVERS, ...DEFAULT_TURN_SERVERS];

  if (customConfig && customConfig.turnUrl) {
    const customEntry = { urls: customConfig.turnUrl };
    if (customConfig.turnUsername) customEntry.username = customConfig.turnUsername;
    if (customConfig.turnCredential) customEntry.credential = customConfig.turnCredential;
    iceServers.unshift(customEntry);
  }

  return iceServers;
}

/**
 * Evaluates whether direct P2P or TURN relay is needed based on candidate types.
 */
function evaluateIceCandidate(candidateStr = '') {
  const s = candidateStr.toLowerCase();
  if (s.includes('typ relay')) {
    return { type: 'relay', description: 'TURN Relay (Symmetric NAT / Cellular CGNAT)' };
  }
  if (s.includes('typ srflx')) {
    return { type: 'srflx', description: 'STUN Server Reflexive (Direct P2P via NAT Hole Punch)' };
  }
  if (s.includes('typ host')) {
    return { type: 'host', description: 'Host Local Interface' };
  }
  return { type: 'unknown', description: 'Standard Candidate' };
}

module.exports = {
  DEFAULT_STUN_SERVERS,
  DEFAULT_TURN_SERVERS,
  getIceServers,
  evaluateIceCandidate
};
