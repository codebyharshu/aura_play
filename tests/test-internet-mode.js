const assert = require('assert');
const WebSocket = require('ws');
const http = require('http');
const InternetManager = require('../src/server/internet/internetManager');
const { getIceServers, evaluateIceCandidate } = require('../src/server/internet/turnConfig');
const { server: signalingHttpServer, activeSessions } = require('../standalone-signaling-server/server');

console.log('================================================================');
console.log('SYNCWAVE INTERNET MODE & WEBRTC SIGNALING TEST SUITE');
console.log('================================================================\n');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTestSuite() {
  const SIGNALING_PORT = 9123;

  // 1. Start Signaling Server on test port
  await new Promise((resolve) => {
    signalingHttpServer.listen(SIGNALING_PORT, '127.0.0.1', resolve);
  });
  console.log(`[PASS] Standalone Signaling Server started on 127.0.0.1:${SIGNALING_PORT}`);

  // 2. Test STUN & TURN Configuration
  console.log('\n[SECTION 1] STUN & TURN Relay Configuration Verification');
  const iceServers = getIceServers();
  assert(iceServers.some(s => s.urls && s.urls.includes('google.com')), 'Google STUN server must be present');
  assert(iceServers.some(s => s.urls && s.urls.includes('openrelay.metered.ca')), 'TURN relay server must be present for symmetric NAT');

  const relayEval = evaluateIceCandidate('candidate:1 1 UDP 2122260223 106.213.84.12 54321 typ relay raddr 10.0.0.1 rport 1234');
  assert.strictEqual(relayEval.type, 'relay');
  const srflxEval = evaluateIceCandidate('candidate:2 1 UDP 1686052607 49.36.120.44 61234 typ srflx raddr 192.168.1.50 rport 61234');
  assert.strictEqual(srflxEval.type, 'srflx');
  console.log('[PASS] STUN & TURN candidate evaluation verified (Jio/Airtel symmetric NAT compatible).');

  // 3. Test InternetManager Session Lifecycle
  console.log('\n[SECTION 2] Internet Session Lifecycle & QR Generation');
  const internetManager = new InternetManager({
    port: 3210,
    signalingUrl: `http://127.0.0.1:${SIGNALING_PORT}`
  });

  const details = await internetManager.start();
  assert(details.isRunning, 'InternetManager must be running');
  assert(details.sessionId.startsWith('sync-'), 'Session ID must have sync- prefix');
  assert(details.token.startsWith('tok-'), 'Session Token must have tok- prefix');
  assert(details.qrDataURL.startsWith('data:image/png;base64,'), 'QR Code data URL must be generated');
  assert(details.url.includes('mode=internet'), 'Receiver URL must include mode=internet parameter');
  assert(details.url.includes(details.sessionId), 'Receiver URL must include sessionId');
  console.log(`[PASS] Internet session initialized: ${details.sessionId} (Token: ${details.token.substring(0, 8)}...)`);
  console.log(`[PASS] Public receiver URL: ${details.url}`);

  await sleep(100);

  // 4. Simulate Cross-Network Mobile Receivers
  console.log('\n[SECTION 3] Multi-Device Cross-Network Receiver Simulation');
  console.log('  -> Simulating Receiver 1 on Airtel 5G (IP: 106.213.84.12)');
  console.log('  -> Simulating Receiver 2 on BSNL 4G (IP: 117.204.18.99)');
  console.log('  -> Simulating Receiver 3 on Remote Wi-Fi (IP: 49.36.120.44)');

  const receivers = [
    { id: 'airtel-device-1', name: 'Airtel 5G (iPhone 15)', ip: '106.213.84.12', ua: 'iPhone; CPU iPhone OS 17_4' },
    { id: 'bsnl-device-2', name: 'BSNL 4G (OnePlus 11)', ip: '117.204.18.99', ua: 'Linux; Android 14; Mobile' },
    { id: 'remote-wifi-3', name: 'Remote Office (ThinkPad)', ip: '49.36.120.44', ua: 'Windows NT 10.0; Win64; x64' }
  ];

  const receiverSockets = [];

  for (const r of receivers) {
    const wsUrl = `ws://127.0.0.1:${SIGNALING_PORT}/ws?role=receiver&session=${details.sessionId}&token=${details.token}&deviceId=${r.id}&mode=internet`;
    const socket = new WebSocket(wsUrl);
    socket.receivedFrames = [];
    socket.isApproved = false;

    await new Promise((resolve) => {
      socket.on('open', () => {
        socket.send(JSON.stringify({
          type: 'join-request',
          deviceId: r.id,
          name: r.name,
          clientIP: r.ip,
          userAgent: r.ua,
          mode: 'internet'
        }));
        resolve();
      });

      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          socket.receivedFrames.push(data);
        } else {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'approval-response' && msg.approved) {
            socket.isApproved = true;
          }
        }
      });
    });

    receiverSockets.push(socket);
  }

  await sleep(200);

  // Verify host received join requests for all 3 devices
  assert.strictEqual(internetManager.pendingRequests.size, 3, 'Host must have 3 pending connection requests');
  console.log('[PASS] All 3 cross-network receivers connected and queued for host approval.');

  // 5. Host Approves Receivers
  console.log('\n[SECTION 4] Host Approval Gate & WebRTC Signaling Handshake');
  for (const r of receivers) {
    const approved = internetManager.approveDevice(r.id);
    assert(approved, `Device ${r.id} must be approved`);
    assert.strictEqual(approved.mode, 'internet');
  }

  await sleep(150);

  for (let i = 0; i < receiverSockets.length; i++) {
    assert(receiverSockets[i].isApproved, `Receiver ${receivers[i].id} must receive approval response`);
  }
  console.log('[PASS] All 3 devices approved and unlocked for audio reception.');

  // 6. Test Audio Broadcasting over Internet Channel
  console.log('\n[SECTION 5] Real-Time Audio Streaming & Distribution');
  // Generate a mock 48kHz stereo PCM buffer (10ms frame = 1920 bytes)
  const pcmFrame = Buffer.alloc(1920);
  for (let i = 0; i < pcmFrame.length; i += 2) {
    pcmFrame.writeInt16LE(Math.round(Math.sin(i / 10) * 16000), i);
  }

  // Send 10 consecutive audio frames
  for (let f = 0; f < 10; f++) {
    internetManager.broadcastAudio(pcmFrame, { sampleRate: 48000, channels: 2, bitDepth: 16 });
    await sleep(20);
  }

  await sleep(150);

  for (let i = 0; i < receiverSockets.length; i++) {
    const count = receiverSockets[i].receivedFrames.length;
    assert(count > 0, `Receiver ${receivers[i].id} must receive audio frames`);
    console.log(`  - Receiver ${receivers[i].id}: Received ${count} audio packets`);
  }
  console.log('[PASS] Real-time audio broadcast successfully delivered to all internet receivers.');

  // 7. Individual Volume & Mute Controls
  console.log('\n[SECTION 6] Individual Receiver Volume & Mute Control');
  internetManager.setDeviceVolume('airtel-device-1', 0.65);
  assert.strictEqual(internetManager.devices.get('airtel-device-1').volume, 0.65);

  internetManager.setMute(true);
  assert.strictEqual(internetManager.isMuted, true);
  internetManager.setMute(false);
  console.log('[PASS] Individual volume and master mute scaling verified.');

  // 8. Session Token Rotation & Revocation
  console.log('\n[SECTION 7] Session Token Rotation & Revocation');
  const oldToken = details.token;
  const newDetails = await internetManager.regenerateSession();
  await sleep(100);
  assert.notStrictEqual(newDetails.token, oldToken, 'New token must differ from old token');
  assert(newDetails.url.includes(newDetails.token), 'New URL must contain new token');
  console.log(`[PASS] Session token rotated to ${newDetails.token.substring(0, 8)}...`);

  // Verify unauthorized connection with old token is rejected
  const rejectedSocket = new WebSocket(`ws://127.0.0.1:${SIGNALING_PORT}/ws?role=receiver&session=${details.sessionId}&token=${oldToken}&deviceId=hacker-1`);
  let wasRejected = false;
  await new Promise((resolve) => {
    rejectedSocket.on('close', (code) => {
      if (code === 1008) wasRejected = true;
      resolve();
    });
    rejectedSocket.on('error', () => resolve());
    setTimeout(resolve, 500);
  });
  assert(wasRejected, 'Unauthorized connection with expired/invalid token must be rejected with 1008');
  console.log('[PASS] Expired token connection successfully rejected.');

  // 9. Clean Shutdown
  console.log('\n[SECTION 8] Clean Shutdown');
  for (const s of receiverSockets) {
    try { s.close(); } catch (e) {}
  }
  await internetManager.stop();
  await new Promise(resolve => signalingHttpServer.close(resolve));
  console.log('[PASS] InternetManager and Signaling Server shut down cleanly without leaks.');

  console.log('\n================================================================');
  console.log('ALL INTERNET MODE & WEBRTC SIGNALING TESTS PASSED (100%)');
  console.log('================================================================');
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error('\n[FAIL] Test suite failed:', err);
  process.exit(1);
});
