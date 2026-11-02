const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

console.log('================================================================');
console.log('TESTING PACKAGED SYNCWAVE.EXE LAUNCH');
console.log('================================================================\n');

const exePath = path.join(__dirname, '..', 'release', 'win-unpacked', 'SyncWave.exe');

console.log('Spawning packaged executable:', exePath);
const child = spawn(exePath, [], {
  detached: true,
  stdio: 'ignore'
});

console.log('Process spawned with PID:', child.pid);
assert(child.pid, 'Failed to obtain PID for spawned SyncWave.exe');

// Allow it to initialize for 4 seconds
setTimeout(() => {
  try {
    // Check if the process is still running (kill with signal 0 checks existence)
    process.kill(child.pid, 0);
    console.log(`[PASS] Packaged SyncWave.exe is active and running cleanly (PID: ${child.pid}).`);

    // Cleanly terminate child
    const { execSync } = require('child_process');
    try {
      execSync(`taskkill /F /PID ${child.pid} /T`);
      console.log('[PASS] Packaged process terminated cleanly.');
    } catch (e) {
      // Ignore if already closed
    }

    console.log('\n================================================================');
    console.log('PACKAGED EXECUTABLE LAUNCH TEST PASSED (100%)');
    console.log('================================================================');
    process.exit(0);
  } catch (err) {
    console.error('[FAIL] Process exited prematurely:', err.message);
    process.exit(1);
  }
}, 4000);
