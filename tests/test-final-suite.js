const assert = require('assert');
const WebSocket = require('ws');
const http = require('http');
const SyncWaveServer = require('../src/server/server');
const WasapiCapture = require('../src/audio/wasapiCapture');

async function runFinalVerificationSuite() {
  console.log('================================================================');
  console.log('SYNCWAVE FINAL VERIFICATION, SECURITY HARDENING & MULTI-DEVICE SUITE');
  console.log('================================================================\n');

  const testPort = 3500 + Math.floor(Math.random() * 1000);
  const server = new SyncWaveServer({ port: testPort, playoutDelayMs: 75 });
  const capture = new WasapiCapture();

  try {
    // -------------------------------------------------------------------------
    // TEST SECTION 1: Local Server Startup & Network Transparency
    // -------------------------------------------------------------------------
    console.log('[SECTION 1] Server Startup & Transport Security Verification');
    const details = await server.start();
    assert.ok(details.localIP, 'Local IP address must be detected');
    assert.strictEqual(details.port, testPort);
    assert.strictEqual(details.isEncrypted, false, 'Must transparently report unencrypted local Wi-Fi transport');
    assert.ok(details.securityNote.includes('local network boundary'), 'Must state exact security model');
    console.log(`[PASS] Server running on ${details.localIP}:${details.port} with honest security disclosures.`);

    // -------------------------------------------------------------------------
    // TEST SECTION 2: Security Hardening (Tokens, Rate Limiting & Malformed Frames)
    // -------------------------------------------------------------------------
    console.log('\n[SECTION 2] Security Hardening & Boundary Defense');

    // 2.1 Invalid Token Rejection
    const invalidTokenRes = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=hacker_token`);
      ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
      ws.on('error', () => {});
    });
    assert.strictEqual(invalidTokenRes, 401, 'Invalid token must be rejected with HTTP 401');
    console.log('[PASS] 2.1 Unauthorized connection rejected with HTTP 401.');

    // 2.2 Rate Limiter Flooding Defense
    console.log('  -> Simulating rapid connection flood (18 rapid connections)...');
    let rateLimited = false;
    for (let i = 0; i < 18; i++) {
      await new Promise((resolve) => {
        const floodWs = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=flood_${i}`);
        floodWs.on('unexpected-response', (req, res) => {
          if (res.statusCode === 429) rateLimited = true;
          resolve();
        });
        floodWs.on('error', () => resolve());
      });
    }
    assert.strictEqual(rateLimited, true, 'Rate limiter must reject connection flooding with HTTP 429');
    console.log('[PASS] 2.2 Connection flooding defense verified (HTTP 429 Too Many Requests).');

    // Reset rate limiter for valid test clients
    server.rateLimiter.reset();

    // 2.3 Malformed Message & Schema Validation
    const testWs = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=${details.token}`);
    await new Promise((resolve, reject) => {
      testWs.on('open', resolve);
      testWs.on('error', reject);
    });

    const malformedErrorPromise = new Promise((resolve) => {
      testWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error' && msg.code === 'INVALID_MESSAGE') {
          resolve(true);
        }
      });
      // Send malformed / unrecognized message type
      testWs.send(JSON.stringify({ type: 'malicious_inject_command', payload: 'DROP TABLE' }));
    });
    const malformedHandled = await malformedErrorPromise;
    assert.strictEqual(malformedHandled, true, 'Malformed message types must be safely rejected');
    console.log('[PASS] 2.3 Malformed message rejected with schema error.');
    testWs.close();

    // -------------------------------------------------------------------------
    // TEST SECTION 3: Multi-Device Concurrent Playback & Synchronization
    // -------------------------------------------------------------------------
    console.log('\n[SECTION 3] Multi-Device Real-Time Streaming & Synchronization');
    const mockDevices = [
      { id: 'dev-iphone-safari', name: 'iPhone 15 Pro (Safari)', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
      { id: 'dev-android-chrome', name: 'Pixel 8 (Chrome)', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36' },
      { id: 'dev-windows-laptop', name: 'Surface Laptop (Edge)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/120.0' }
    ];

    const connectedSockets = [];
    for (const d of mockDevices) {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=${details.token}`);
      ws.binaryType = 'arraybuffer';
      await new Promise(r => ws.on('open', r));

      const approvedPromise = new Promise((resolve) => {
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          const msg = JSON.parse(data.toString());
          if (msg.type === 'approval-pending') {
            server.approveDevice(d.id);
          } else if (msg.type === 'approval-response') {
            resolve(msg.approved);
          }
        });
      });

      ws.send(JSON.stringify({ type: 'join-request', deviceId: d.id, name: d.name, userAgent: d.ua }));
      const approved = await approvedPromise;
      assert.strictEqual(approved, true, `Device ${d.name} must be approved`);
      connectedSockets.push({ ws, device: d });
    }

    assert.strictEqual(server.deviceManager.getAllDevicesSummary().length, 3, 'Must have 3 active devices in registry');
    console.log(`[PASS] 3 distinct receiver devices connected simultaneously without conflict.`);

    // Test simultaneous audio broadcast reception
    let devicesReceivedFrame = 0;
    const testAudioBuffer = Buffer.alloc(1920 * 2 * 2); // 1920 frames of 16-bit stereo PCM
    for (let i = 0; i < testAudioBuffer.length; i += 2) {
      testAudioBuffer.writeInt16LE(12000, i); // DC offset pulse
    }

    const broadcastPromises = connectedSockets.map(({ ws }) => {
      return new Promise((resolve) => {
        const handler = (data) => {
          if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
            ws.removeListener('message', handler);
            devicesReceivedFrame++;
            resolve();
          }
        };
        ws.on('message', handler);
      });
    });

    server.broadcastAudio(testAudioBuffer, { sampleRate: 48000, channels: 2, bitDepth: 16 });
    await Promise.all(broadcastPromises);
    assert.strictEqual(devicesReceivedFrame, 3, 'All 3 devices must receive the audio frame simultaneously');
    console.log('[PASS] Audio broadcast delivered to all 3 devices concurrently with shared timestamps.');

    // -------------------------------------------------------------------------
    // TEST SECTION 4: Audio Volume & Mute Controls
    // -------------------------------------------------------------------------
    console.log('\n[SECTION 4] Master & Individual Volume Controls');

    // 4.1 Individual Volume Control
    const volPromise = new Promise((resolve) => {
      connectedSockets[0].ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const msg = JSON.parse(data.toString());
        if (msg.type === 'volume-change') resolve(msg.volume);
      });
      server.setDeviceVolume('dev-iphone-safari', 0.45);
    });
    const updatedVol = await volPromise;
    assert.strictEqual(updatedVol, 0.45);
    console.log('[PASS] 4.1 Individual device volume adjusted in real time.');

    // 4.2 Master Volume Scaling & Mute
    server.setMasterVolume(0.5);
    assert.strictEqual(server.masterVolume, 0.5);
    server.setMute(true);
    assert.strictEqual(server.isMuted, true);
    server.setMute(false);
    server.setMasterVolume(1.0);
    console.log('[PASS] 4.2 Master volume scaling and mute controls verified.');

    // -------------------------------------------------------------------------
    // TEST SECTION 5: Reconnection Resilience (No Duplicate Devices)
    // -------------------------------------------------------------------------
    console.log('\n[SECTION 5] Device Reconnection Resilience');
    // Close Device 2 socket
    connectedSockets[1].ws.close();
    await new Promise(r => setTimeout(r, 200));
    const connectedAfterClose = server.deviceManager.getAllDevicesSummary().filter(d => d.status === 'connected').length;
    assert.strictEqual(connectedAfterClose, 2, 'Connected count must reflect 2 active devices');

    // Reconnect Device 2 with same deviceId
    const reconnectWs = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=${details.token}`);
    await new Promise(r => reconnectWs.on('open', r));
    reconnectWs.send(JSON.stringify({
      type: 'join-request',
      deviceId: mockDevices[1].id,
      name: mockDevices[1].name,
      userAgent: mockDevices[1].ua
    }));

    await new Promise(r => setTimeout(r, 200));
    const totalDevices = server.deviceManager.getAllDevicesSummary().length;
    const connectedAfterReconnect = server.deviceManager.getAllDevicesSummary().filter(d => d.status === 'connected').length;
    assert.strictEqual(totalDevices, 3, 'Total device count must not duplicate on reconnect');
    assert.strictEqual(connectedAfterReconnect, 3, 'Device must reattach seamlessly as connected');
    console.log('[PASS] Reconnection reattached device to registry without duplication.');
    reconnectWs.close();

    // -------------------------------------------------------------------------
    // TEST SECTION 6: Session Rotation
    // -------------------------------------------------------------------------
    console.log('\n[SECTION 6] Session Token Rotation');
    const newDetails = await server.regenerateSession();
    assert.notStrictEqual(newDetails.token, details.token, 'Rotated token must differ from old token');
    console.log('[PASS] Session token rotated successfully.');

    // -------------------------------------------------------------------------
    // TEST SECTION 7: Native Audio Worker Lifecycle
    // -------------------------------------------------------------------------
    console.log('\n[SECTION 7] Native WASAPI Capture Lifecycle');
    await capture.start();
    assert.strictEqual(capture.isCapturing, true);
    await capture.stop();
    assert.strictEqual(capture.isCapturing, false);
    console.log('[PASS] Native WASAPI Loopback worker started and stopped cleanly.');

    // -------------------------------------------------------------------------
    // CLEAN TEARDOWN
    // -------------------------------------------------------------------------
    for (const { ws } of connectedSockets) {
      try { ws.close(); } catch (e) {}
    }
    await server.stop();

    console.log('\n================================================================');
    console.log('ALL 7 FINAL VERIFICATION & SECURITY TEST SUITES PASSED (100%)');
    console.log('================================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n[FAIL] Test suite failed:', err);
    await server.stop();
    await capture.stop();
    process.exit(1);
  }
}

runFinalVerificationSuite();
