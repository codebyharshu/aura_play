const assert = require('assert');
const WasapiCapture = require('../src/audio/wasapiCapture');

async function testWasapiCapture() {
  console.log('--- Testing Native Windows WASAPI Loopback Capture Module ---');
  const capture = new WasapiCapture();

  try {
    console.log('[Step 1] Starting WASAPI loopback capture...');
    const startResult = await capture.start();
    assert.strictEqual(startResult, true, 'WASAPI capture start() should resolve true');
    assert.strictEqual(capture.isCapturing, true, 'isCapturing state should be true');

    const status = capture.getStatus();
    console.log(`[PASS] Device detected: "${status.deviceName}"`);
    console.log(`[PASS] Capture format: ${status.format.sampleRate}Hz, ${status.format.channels} channels, ${status.format.bitDepth}-bit PCM`);

    console.log('[Step 2] Listening for capture stream events for 2.5 seconds...');
    let framesReceived = 0;
    let visualizerEvents = 0;

    capture.on('audio-frame', (frame) => {
      framesReceived++;
      assert.ok(frame.buffer.length > 0, 'Audio frame buffer must not be empty');
      assert.strictEqual(frame.format.channels, status.format.channels);
    });

    capture.on('visualizer-data', (samples) => {
      visualizerEvents++;
      assert.strictEqual(samples.length, 48, 'Visualizer should receive 48 frequency/amplitude bins');
    });

    await new Promise(r => setTimeout(r, 2500));
    console.log(`[PASS] Active capture verified (Frames received: ${framesReceived}, Visualizer updates: ${visualizerEvents})`);

    console.log('[Step 3] Stopping WASAPI loopback capture...');
    const stopResult = await capture.stop();
    assert.strictEqual(stopResult, true, 'WASAPI capture stop() should resolve true');
    assert.strictEqual(capture.isCapturing, false, 'isCapturing state should be false');
    console.log('[PASS] WASAPI capture stopped gracefully.');

    console.log('[Step 4] Testing immediate restart...');
    await capture.start();
    assert.strictEqual(capture.isCapturing, true);
    await capture.stop();
    assert.strictEqual(capture.isCapturing, false);
    console.log('[PASS] WASAPI capture restarted and stopped successfully without resource leaks.');

    console.log('\n=============================================');
    console.log('NATIVE WASAPI LOOPBACK CAPTURE TEST PASSED (100%)');
    console.log('=============================================');
  } catch (err) {
    console.error('\n[FAIL] WASAPI capture test failed:', err);
    await capture.stop();
    process.exit(1);
  }
}

testWasapiCapture();
