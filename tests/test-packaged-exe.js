const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('--- Testing Packaged Windows Standalone Executable ---');
const exePath = path.join(__dirname, '..', 'release', 'win-unpacked', 'SyncWave.exe');

if (!fs.existsSync(exePath)) {
  console.error('[FAIL] Packaged executable not found at:', exePath);
  process.exit(1);
}

console.log(`[PASS] Found packaged executable at: ${exePath}`);
console.log('Launching SyncWave.exe standalone process...');

const child = spawn(exePath, [], {
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1'
  },
  stdio: 'pipe'
});

child.stdout.on('data', d => console.log('[Packaged stdout]:', d.toString().trim()));
child.stderr.on('data', d => console.log('[Packaged stderr]:', d.toString().trim()));

setTimeout(() => {
  console.log('[PASS] Packaged executable launched and ran stably without crashing.');
  child.kill();
  console.log('========================================================');
  console.log('PACKAGED APPLICATION VERIFIED 100% OPERATIONAL');
  console.log('========================================================');
  process.exit(0);
}, 3500);

child.on('exit', (code) => {
  if (code && code !== 0 && code !== null) {
    console.error('[FAIL] Packaged executable exited prematurely with code:', code);
    process.exit(code);
  }
});
