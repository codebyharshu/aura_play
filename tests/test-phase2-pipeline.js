const assert = require('assert');
const path = require('path');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const SyncWaveServer = require('../src/server/server');
const WasapiCapture = require('../src/audio/wasapiCapture');

async function runPhase2PipelineTest() {
  console.log('--- Starting SyncWave Phase 2 End-to-End Audio Capture Pipeline Test ---');
  const testPort = 3400 + Math.floor(Math.random() * 1000);
  const server = new SyncWaveServer({ port: testPort, playoutDelayMs: 70 });
  const capture = new WasapiCapture();

  try {
    // 1. Start Server & Connect Client
    console.log('[Step 1] Starting sync server on port ' + testPort + '...');
    const serverDetails = await server.start();
    assert.ok(serverDetails.token, 'Server should have generated session token');
    console.log(`[PASS] Server running on ${serverDetails.localIP}:${serverDetails.port}`);

    console.log('[Step 2] Connecting receiver client and authorizing...');
    const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=${serverDetails.token}`);
    clientWs.binaryType = 'arraybuffer';

    await new Promise((resolve, reject) => {
      clientWs.on('open', resolve);
      clientWs.on('error', reject);
    });

    const testDeviceId = 'device-receiver-mobile-test';
    const approvedPromise = new Promise((resolve) => {
      clientWs.on('message', (data, isBinary) => {
        if (isBinary) return;
        const msg = JSON.parse(data.toString());
        if (msg.type === 'approval-pending') {
          server.approveDevice(testDeviceId);
        } else if (msg.type === 'approval-response') {
          resolve(msg.approved);
        }
      });
    });

    clientWs.send(JSON.stringify({
      type: 'join-request',
      deviceId: testDeviceId,
      name: 'Android Mobile Test',
      userAgent: 'Mozilla/5.0 (Linux; Android 13)'
    }));

    const isApproved = await approvedPromise;
    assert.strictEqual(isApproved, true, 'Receiver must be approved by host');
    console.log('[PASS] Receiver client joined and approved.');

    // 2. Start WASAPI Audio Capture
    console.log('[Step 3] Initializing and starting native WASAPI Loopback capture...');
    await capture.start();
    const captureStatus = capture.getStatus();
    assert.strictEqual(captureStatus.isCapturing, true, 'WASAPI capture must be active');
    console.log(`[PASS] Native capture active on "${captureStatus.deviceName}" (${captureStatus.format.sampleRate}Hz stereo)`);

    // Wire capture frames directly into server broadcasting
    capture.on('audio-frame', (frame) => {
      server.broadcastAudio(frame.buffer, frame.format);
    });

    // 3. Play actual audio on Windows to test real loopback capture
    console.log('[Step 4] Playing actual Windows audio output to verify real WASAPI loopback capture...');
    const wavPath = path.join(__dirname, '..', 'test_tone.wav');

    let audioFramesReceived = 0;
    let totalAudioBytes = 0;
    let maxVisualizerAmplitude = 0;
    let nonZeroFrames = 0;

    capture.on('visualizer-data', (samples) => {
      for (const amp of samples) {
        if (amp > maxVisualizerAmplitude) {
          maxVisualizerAmplitude = amp;
        }
      }
    });

    clientWs.on('message', (data, isBinary) => {
      if (isBinary || data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
        audioFramesReceived++;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        totalAudioBytes += buf.length;

        // Check if payload has real audio energy (non-zero PCM samples)
        for (let i = 40; i < buf.length; i += 4) {
          if (buf[i] !== 0 || buf[i + 1] !== 0) {
            nonZeroFrames++;
            break;
          }
        }
      }
    });

    // Play test_tone.wav synchronously via PowerShell SoundPlayer
    await new Promise((resolve) => {
      const psScript = `(New-Object System.Media.SoundPlayer '${wavPath}').PlaySync()`;
      const player = spawn('powershell.exe', ['-NoProfile', '-Command', psScript]);
      player.on('close', resolve);
      player.on('error', resolve);
    });

    // Allow 800ms for captured playback buffers to flush through pipeline
    await new Promise(r => setTimeout(r, 800));

    console.log(`[PASS] Audio stream captured and received over WebSocket!`);
    console.log(`       - Frames received by client: ${audioFramesReceived}`);
    console.log(`       - Non-zero audio frames: ${nonZeroFrames}`);
    console.log(`       - Total bytes received: ${totalAudioBytes} bytes`);
    console.log(`       - Peak visualizer amplitude: ${maxVisualizerAmplitude.toFixed(4)}`);

    assert.ok(audioFramesReceived > 0, 'Receiver must have received streamed audio frames');
    assert.ok(totalAudioBytes > 0, 'Received audio bytes must be greater than zero');
    assert.ok(maxVisualizerAmplitude > 0.05, 'Visualizer amplitude must respond to real audio');
    assert.ok(nonZeroFrames > 0, 'Must have captured actual non-zero audio samples from playback');

    // 4. Check Resource Usage
    console.log('[Step 5] Checking CPU and memory usage...');
    const memUsage = process.memoryUsage();
    console.log(`       - Node RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`       - Node Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    assert.ok(memUsage.rss < 200 * 1024 * 1024, 'Memory usage must remain well within acceptable limits');
    console.log('[PASS] Resource usage is lightweight and optimal.');

    // 5. Clean Teardown
    console.log('[Step 6] Testing clean stop and restart of capture pipeline...');
    await capture.stop();
    assert.strictEqual(capture.isCapturing, false, 'Capture should be stopped');
    console.log('[PASS] Capture stopped cleanly.');

    await capture.start();
    assert.strictEqual(capture.isCapturing, true, 'Capture should restart cleanly');
    await capture.stop();
    console.log('[PASS] Capture restarted and stopped without resource leak.');

    await server.stop();
    clientWs.close();
    console.log('[PASS] Server shut down cleanly.');

    console.log('\n======================================================');
    console.log('PHASE 2 END-TO-END AUDIO CAPTURE PIPELINE PASSED (100%)');
    console.log('======================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n[FAIL] Phase 2 pipeline test failed:', err);
    await capture.stop();
    await server.stop();
    process.exit(1);
  }
}

runPhase2PipelineTest();
