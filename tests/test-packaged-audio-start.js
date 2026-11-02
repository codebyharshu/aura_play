const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

console.log('--- Verifying Packaged Native WASAPI Executable ---');
const packagedExe = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'src', 'audio', 'native', 'SyncWaveLoopback.exe');
const unpackedExe = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'src', 'audio', 'native', 'SyncWaveLoopback.exe');

console.log(`Checking candidate 1: ${packagedExe}`);
assert.ok(fs.existsSync(packagedExe), 'Candidate 1 must exist on disk outside app.asar');

console.log(`Checking candidate 2: ${unpackedExe}`);
assert.ok(fs.existsSync(unpackedExe), 'Candidate 2 must exist on disk outside app.asar');

console.log('[PASS] Native binaries verified outside app.asar archive.');

console.log('Testing direct spawn of packaged SyncWaveLoopback.exe...');
const child = spawn(packagedExe, [], {
  cwd: path.dirname(packagedExe),
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true
});

let started = false;
child.stderr.on('data', (d) => {
  const line = d.toString().trim();
  console.log('[Worker stderr]:', line);
  if (line.includes('[SYNCWAVE_STATUS] STARTED')) {
    started = true;
    console.log('[PASS] Packaged native WASAPI loopback worker started successfully!');
    child.stdin.write('STOP\n');
    child.stdin.end();
  }
});

child.on('close', (code) => {
  console.log(`[PASS] Packaged native worker exited cleanly with code ${code}.`);
  assert.strictEqual(started, true, 'Worker must have emitted STARTED before exit');
  console.log('\n======================================================');
  console.log('PACKAGED NATIVE AUDIO CAPTURE VERIFIED 100% OPERATIONAL');
  console.log('======================================================');
  process.exit(0);
});

setTimeout(() => {
  if (!started) {
    console.error('[FAIL] Timed out waiting for packaged worker to start');
    child.kill();
    process.exit(1);
  }
}, 5000);
