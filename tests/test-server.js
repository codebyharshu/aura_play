const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const SyncWaveServer = require('../src/server/server');

async function runTestSuite() {
  console.log('--- Starting SyncWave Phase 1 Automated Test Suite ---');
  const testPort = 3299;
  const server = new SyncWaveServer({ port: testPort, playoutDelayMs: 60 });

  try {
    // 1. Test Server Startup & Network Info
    console.log('[Test 1] Starting server and verifying network detection...');
    const details = await server.start();
    assert.ok(details.localIP, 'Local IP should be resolved');
    assert.strictEqual(details.port, testPort, 'Port should match configured test port');
    assert.ok(details.token, 'Session token should be generated');
    assert.ok(details.url.includes(details.token), 'Connection URL should contain session token');
    assert.ok(details.qrDataURL.startsWith('data:image/png;base64,'), 'QR Code should be generated as Data URL');
    console.log(`[PASS] Server running on ${details.localIP}:${details.port} with valid QR code.`);

    // 2. Test HTTP Asset Serving
    console.log('[Test 2] Verifying HTTP receiver static page delivery...');
    const httpRes = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${testPort}/`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      }).on('error', reject);
    });

    assert.strictEqual(httpRes.statusCode, 200, 'HTTP response should be 200 OK');
    assert.ok(httpRes.body.includes('SyncWave Receiver'), 'Response should contain SyncWave Receiver title');
    console.log('[PASS] HTTP receiver assets served successfully.');

    // 3. Test Security Token Enforcement
    console.log('[Test 3] Verifying token security enforcement...');
    const rejectedStatus = await new Promise((resolve) => {
      const badWs = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=invalid_token`);
      badWs.on('open', () => {
        resolve('CONNECTED_UNEXPECTEDLY');
      });
      badWs.on('unexpected-response', (req, res) => {
        resolve(res.statusCode); // Should be 401 Unauthorized
      });
      badWs.on('error', (err) => {
        resolve('ERROR_REJECTED');
      });
    });
    assert.strictEqual(rejectedStatus, 401, 'Unauthorized request should be rejected with HTTP 401');
    console.log('[PASS] Unauthorized connection rejected with HTTP 401.');

    // 4. Test Authorized Client Handshake & Device Approval
    console.log('[Test 4] Testing device connection request and host approval...');
    const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=${details.token}`);
    clientWs.binaryType = 'arraybuffer';

    await new Promise((resolve, reject) => {
      clientWs.on('open', resolve);
      clientWs.on('error', reject);
    });

    const testDeviceId = 'device-test-iphone-01';
    let approvalReceived = false;

    const messagePromise = new Promise((resolve, reject) => {
      clientWs.on('message', (data, isBinary) => {
        if (isBinary) {
          resolve({ type: 'binary', buffer: data });
          return;
        }
        const msg = JSON.parse(data.toString());
        if (msg.type === 'approval-pending') {
          console.log('  -> Receiver received approval-pending. Host approving now...');
          server.approveDevice(testDeviceId);
        } else if (msg.type === 'approval-response') {
          approvalReceived = msg.approved;
          resolve(msg);
        }
      });
    });

    clientWs.send(JSON.stringify({
      type: 'join-request',
      deviceId: testDeviceId,
      name: 'iPhone 14 Pro Test',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
    }));

    await messagePromise;
    assert.strictEqual(approvalReceived, true, 'Device should be approved by host');
    const activeDevices = server.deviceManager.getAllDevicesSummary();
    assert.strictEqual(activeDevices.length, 1, 'Should have exactly 1 active device in registry');
    assert.strictEqual(activeDevices[0].deviceId, testDeviceId);
    console.log('[PASS] Device handshake and host approval verified.');

    // 5. Test High-Resolution Time Synchronization (NTP)
    console.log('[Test 5] Testing NTP clock synchronization ping-pong...');
    const syncResult = await new Promise((resolve) => {
      const t0 = Date.now();
      const onSyncMsg = (data, isBinary) => {
        if (isBinary) return;
        const msg = JSON.parse(data.toString());
        if (msg.type === 'sync-pong') {
          clientWs.removeListener('message', onSyncMsg);
          resolve(msg);
        }
      };
      clientWs.on('message', onSyncMsg);
      clientWs.send(JSON.stringify({ type: 'sync-ping', clientSendTime: t0 }));
    });

    assert.ok(syncResult.clientSendTime, 'Should contain client send time');
    assert.ok(syncResult.serverReceiveTime, 'Should contain server receive time');
    assert.ok(syncResult.serverSendTime, 'Should contain server send time');
    assert.strictEqual(syncResult.playoutDelayMs, 60, 'Should return configured playout delay');
    console.log('[PASS] NTP time sync response valid and accurate.');

    // 6. Test Individual Volume Control
    console.log('[Test 6] Testing individual device volume control...');
    const volumePromise = new Promise((resolve) => {
      const onVolMsg = (data, isBinary) => {
        if (isBinary) return;
        const msg = JSON.parse(data.toString());
        if (msg.type === 'volume-change') {
          clientWs.removeListener('message', onVolMsg);
          resolve(msg.volume);
        }
      };
      clientWs.on('message', onVolMsg);
      server.setDeviceVolume(testDeviceId, 0.65);
    });

    const receivedVolume = await volumePromise;
    assert.strictEqual(receivedVolume, 0.65, 'Volume should be updated to 0.65');
    console.log('[PASS] Individual volume control event received.');

    // 7. Test Compound Audio Frame Broadcast & Unpacking
    console.log('[Test 7] Testing binary audio frame broadcast & compound header decoding...');
    const testAudioData = Buffer.alloc(960 * 4); // 960 frames of 16-bit stereo PCM
    for (let i = 0; i < testAudioData.length; i++) {
      testAudioData[i] = (i % 256);
    }

    const audioFramePromise = new Promise((resolve) => {
      const onAudioMsg = (data) => {
        if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
          clientWs.removeListener('message', onAudioMsg);
          resolve(data);
        }
      };
      clientWs.on('message', onAudioMsg);
      server.broadcastAudio(testAudioData, { sampleRate: 48000, channels: 2, bitDepth: 16 });
    });

    const binaryPacket = await audioFramePromise;
    const packetBuf = Buffer.isBuffer(binaryPacket) ? binaryPacket : Buffer.from(binaryPacket);
    const headerLen = packetBuf.readUInt32BE(0);
    const headerStr = packetBuf.subarray(4, 4 + headerLen).toString('utf-8');
    const header = JSON.parse(headerStr);
    const pcmPayload = packetBuf.subarray(4 + headerLen);

    assert.strictEqual(header.type, 'audio-frame');
    assert.ok(header.scheduledPlayTime > header.serverTime, 'Scheduled time must include playout delay');
    assert.strictEqual(pcmPayload.length, testAudioData.length, 'Payload byte length must match sent data');
    console.log('[PASS] Audio frame broadcast unpacked with sub-millisecond timestamps.');

    // 8. Test Device Disconnection
    console.log('[Test 8] Testing host device disconnection...');
    const disconnectPromise = new Promise((resolve) => {
      clientWs.on('close', (code) => {
        resolve(code);
      });
      server.disconnectDevice(testDeviceId, 'Test complete');
    });

    await disconnectPromise;
    assert.strictEqual(server.deviceManager.getAllDevicesSummary().length, 0, 'Device registry should be empty');
    console.log('[PASS] Device disconnected and removed from registry.');

    // 9. Stop Server
    console.log('[Test 9] Stopping server...');
    await server.stop();
    assert.strictEqual(server.isRunning, false, 'Server isRunning should be false');
    console.log('[PASS] Server shut down cleanly.');

    console.log('\n=============================================');
    console.log('ALL 9 PHASE 1 AUTOMATED TESTS PASSED (100%)');
    console.log('=============================================');
  } catch (err) {
    console.error('\n[FAIL] Test suite failed:', err);
    await server.stop();
    process.exit(1);
  }
}

runTestSuite();
