/**
 * SyncWave Standalone Internet Signaling & WebRTC Relay Server
 *
 * This server acts as the public rendezvous point for SyncWave Internet Mode.
 * It terminates public HTTPS/WSS connections from mobile devices on 4G/5G,
 * relays WebRTC signaling (Offer/Answer/ICE) to the desktop host,
 * and serves the mobile receiver web application.
 *
 * Free deployment targets: Render.com, Railway, Glitch, Fly.io, or VPS.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours max session lifetime

// In-memory session registry: sessionId -> { hostSocket, token, createdAt, receivers: Map() }
const activeSessions = new Map();

// Helper to resolve receiver static files (checks local folder or parent public/receiver)
function resolveReceiverDir() {
  const localDir = path.join(__dirname, 'public', 'receiver');
  if (fs.existsSync(localDir)) return localDir;
  const parentDir = path.join(__dirname, '..', 'public', 'receiver');
  if (fs.existsSync(parentDir)) return parentDir;
  return localDir;
}

const receiverDir = resolveReceiverDir();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

// HTTP Server for serving receiver files & health check
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check API
  if (url.pathname === '/health' || url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'SyncWave Public Signaling Server',
      activeSessions: activeSessions.size,
      timestamp: Date.now()
    }));
    return;
  }

  // Session verification endpoint
  if (url.pathname === '/api/session-info') {
    const sessionId = url.searchParams.get('session');
    const token = url.searchParams.get('token');
    const session = activeSessions.get(sessionId);

    if (!session || session.token !== token) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ valid: false, error: 'Session not found or token expired' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      valid: true,
      sessionId,
      hostConnected: !!(session.hostSocket && session.hostSocket.readyState === WebSocket.OPEN),
      serverTime: Date.now()
    }));
    return;
  }

  // Serve receiver static files
  let filePath = path.join(receiverDir, url.pathname === '/' || url.pathname === '/receiver' || url.pathname === '/receiver/' ? 'index.html' : url.pathname.replace(/^\/receiver\//, ''));

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(receiverDir, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
  }
});

// WebSocket Server for Signaling & Audio Relaying
const wss = new WebSocket.Server({ server });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get('role'); // 'host' or 'receiver'
  const sessionId = url.searchParams.get('session');
  const token = url.searchParams.get('token');
  const clientIP = req.socket.remoteAddress.replace(/^.*:/, '') || 'Unknown';

  if (!sessionId || !token) {
    socket.close(1008, 'Missing sessionId or token');
    return;
  }

  // Role: Desktop Host
  if (role === 'host') {
    handleHostConnection(socket, sessionId, token, clientIP);
    return;
  }

  // Role: Mobile Receiver
  if (role === 'receiver') {
    handleReceiverConnection(socket, sessionId, token, clientIP, url);
    return;
  }

  socket.close(1008, 'Invalid connection role');
});

function handleHostConnection(socket, sessionId, token, clientIP) {
  let session = activeSessions.get(sessionId);

  if (!session) {
    session = {
      sessionId,
      token,
      hostSocket: socket,
      clientIP,
      createdAt: Date.now(),
      receivers: new Map() // deviceId -> socket
    };
    activeSessions.set(sessionId, session);
  } else {
    if (session.token !== token) {
      socket.close(1008, 'Token mismatch for existing session');
      return;
    }
    session.hostSocket = socket;
  }

  console.log(`[Host Connected] Session: ${sessionId} from ${clientIP}`);

  socket.send(JSON.stringify({
    type: 'host-registered',
    sessionId,
    serverTime: Date.now()
  }));

  socket.on('message', (data, isBinary) => {
    // If binary audio frame from host: relay to all approved receiver sockets
    if (isBinary) {
      for (const receiverSocket of session.receivers.values()) {
        if (receiverSocket.readyState === WebSocket.OPEN && receiverSocket.isApproved) {
          receiverSocket.send(data, { binary: true });
        }
      }
      return;
    }

    try {
      const msg = JSON.parse(data.toString());
      handleHostMessage(session, msg);
    } catch (e) {
      console.error('Error parsing host message:', e);
    }
  });

  socket.on('close', () => {
    console.log(`[Host Disconnected] Session: ${sessionId}`);
    // Notify all connected receivers that host disconnected
    for (const receiverSocket of session.receivers.values()) {
      if (receiverSocket.readyState === WebSocket.OPEN) {
        receiverSocket.send(JSON.stringify({
          type: 'host-disconnected',
          message: 'The desktop host disconnected from the signaling session.'
        }));
      }
    }
  });
}

function handleHostMessage(session, msg) {
  switch (msg.type) {
    case 'session-token-updated': {
      session.token = msg.token;
      console.log(`[Session Token Rotated] Session: ${session.sessionId}`);
      break;
    }

    case 'approval-response':
    case 'webrtc-offer':
    case 'ice-candidate':
    case 'volume-change':
    case 'disconnect': {
      // Forward target message to specific receiver
      const targetSocket = session.receivers.get(msg.deviceId);
      if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
        if (msg.type === 'approval-response' && msg.approved) {
          targetSocket.isApproved = true;
        }
        targetSocket.send(JSON.stringify(msg));
      }
      break;
    }

    case 'sync-pong': {
      const targetSocket = session.receivers.get(msg.deviceId);
      if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
        targetSocket.send(JSON.stringify(msg));
      }
      break;
    }

    default:
      break;
  }
}

function handleReceiverConnection(socket, sessionId, token, clientIP, url) {
  const session = activeSessions.get(sessionId);

  if (!session || session.token !== token) {
    socket.close(1008, 'Unauthorized: Invalid session or token');
    return;
  }

  const deviceId = url.searchParams.get('deviceId') || ('dev-' + Math.random().toString(36).substring(2, 8));
  socket.deviceId = deviceId;
  socket.isApproved = false;
  socket.clientIP = clientIP;

  session.receivers.set(deviceId, socket);
  console.log(`[Receiver Connected] Device: ${deviceId} (${clientIP}) -> Session: ${sessionId}`);

  socket.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      msg.deviceId = deviceId;
      msg.clientIP = clientIP;

      // Forward signaling messages from receiver to host
      if (session.hostSocket && session.hostSocket.readyState === WebSocket.OPEN) {
        session.hostSocket.send(JSON.stringify(msg));
      }
    } catch (e) {
      console.error('Error parsing receiver message:', e);
    }
  });

  socket.on('close', () => {
    session.receivers.delete(deviceId);
    console.log(`[Receiver Disconnected] Device: ${deviceId}`);
    // Notify host
    if (session.hostSocket && session.hostSocket.readyState === WebSocket.OPEN) {
      session.hostSocket.send(JSON.stringify({
        type: 'receiver-disconnected',
        deviceId
      }));
    }
  });
}

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions.entries()) {
    if (now - session.createdAt > SESSION_TIMEOUT_MS) {
      console.log(`[Session Expired] ${id}`);
      activeSessions.delete(id);
    }
  }
}, 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`================================================================`);
  console.log(`SyncWave Public Signaling Server running on port ${PORT}`);
  console.log(`Ready for WebRTC signaling and cross-network receiver connections`);
  console.log(`================================================================`);
});

module.exports = { server, wss, activeSessions };
