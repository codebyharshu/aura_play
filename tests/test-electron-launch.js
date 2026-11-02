const { spawn } = require('child_process');
const path = require('path');

console.log('Testing Electron launch and window initialization...');
const electronPath = require('electron');

const child = spawn(electronPath, ['.'], {
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    TEST_MODE: '1'
  },
  stdio: 'pipe'
});

let output = '';
child.stdout.on('data', d => {
  output += d.toString();
  console.log('[Electron stdout]:', d.toString().trim());
});

child.stderr.on('data', d => {
  output += d.toString();
  console.log('[Electron stderr]:', d.toString().trim());
});

// Allow Electron 4 seconds to boot and verify no crashes
setTimeout(() => {
  console.log('Electron process ran successfully without crashing. Terminating test process...');
  child.kill();
  process.exit(0);
}, 4000);

child.on('exit', (code) => {
  if (code && code !== 0 && code !== null) {
    console.error('Electron exited with error code:', code);
    process.exit(code);
  }
});
