const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('assert');

console.log('================================================================');
console.log('SYNCWAVE PACKAGED BUILD & UI VERIFICATION');
console.log('================================================================\n');

// 1. Check executable exists
const exePath = path.join(__dirname, '..', 'release', 'win-unpacked', 'SyncWave.exe');
console.log('[STEP 1] Checking packaged executable path:', exePath);
assert(fs.existsSync(exePath), 'Packaged SyncWave.exe does not exist!');
const stats = fs.statSync(exePath);
console.log(`[PASS] SyncWave.exe exists (size: ${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

// 2. Check native worker binaries exist in unpacked directory
const nativeExeInResources = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'src', 'audio', 'native', 'SyncWaveLoopback.exe');
const nativeExeInAsarUnpacked = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'src', 'audio', 'native', 'SyncWaveLoopback.exe');
console.log('\n[STEP 2] Checking native audio worker binaries...');
const hasResourceExe = fs.existsSync(nativeExeInResources);
const hasAsarUnpackedExe = fs.existsSync(nativeExeInAsarUnpacked);
console.log('  - extraResources SyncWaveLoopback.exe:', hasResourceExe ? 'FOUND' : 'NOT FOUND');
console.log('  - asarUnpack SyncWaveLoopback.exe:', hasAsarUnpackedExe ? 'FOUND' : 'NOT FOUND');
assert(hasResourceExe || hasAsarUnpackedExe, 'Native SyncWaveLoopback.exe not found in packaged output!');
console.log('[PASS] Native audio worker binary is correctly included.');

// 3. Extract and verify app.asar contents (updated UI & styles)
console.log('\n[STEP 3] Inspecting app.asar package contents...');
const asarPath = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');
assert(fs.existsSync(asarPath), 'app.asar not found!');

// Extract app.js and style.css to verify updated code
const tempDir = path.join(__dirname, 'temp_inspect');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

try {
  execSync(`npx asar extract "${asarPath}" "${tempDir}"`, { stdio: 'pipe' });
  const appJs = fs.readFileSync(path.join(tempDir, 'src', 'renderer', 'js', 'app.js'), 'utf8');
  const styleCss = fs.readFileSync(path.join(tempDir, 'src', 'renderer', 'css', 'style.css'), 'utf8');

  // Verify app.js updates
  assert(appJs.includes('deviceMuteStates'), 'Packaged app.js does not contain deviceMuteStates!');
  assert(appJs.includes('btn-dev-mute'), 'Packaged app.js does not contain btn-dev-mute!');
  assert(appJs.includes('dev-status-pill'), 'Packaged app.js does not contain dev-status-pill!');
  assert(appJs.includes('dev-type-badge'), 'Packaged app.js does not contain dev-type-badge!');
  assert(appJs.includes('modeInternetBtn'), 'Packaged app.js does not contain modeInternetBtn!');
  assert(appJs.includes('startInternetSync'), 'Packaged app.js does not contain startInternetSync!');
  console.log('[PASS] Packaged app.js verified with all device UI & Internet Mode improvements.');

  // Verify Internet Mode server modules inside app.asar
  assert(fs.existsSync(path.join(tempDir, 'src', 'server', 'internet', 'internetManager.js')), 'Missing packaged internetManager.js');
  assert(fs.existsSync(path.join(tempDir, 'src', 'server', 'internet', 'turnConfig.js')), 'Missing packaged turnConfig.js');
  assert(fs.existsSync(path.join(tempDir, 'src', 'server', 'internet', 'tunnelManager.js')), 'Missing packaged tunnelManager.js');
  console.log('[PASS] Packaged Internet Mode modules (internetManager, turnConfig, tunnelManager) verified.');

  // Verify style.css updates
  assert(styleCss.includes('.devices-and-sync-card'), 'Packaged style.css missing .devices-and-sync-card');
  assert(styleCss.includes('min-height: 260px'), 'Packaged style.css missing min-height: 260px');
  assert(styleCss.includes('.device-list-container::-webkit-scrollbar-thumb'), 'Packaged style.css missing scrollbar thumb styling');
  assert(styleCss.includes('min-height: 48px'), 'Packaged style.css missing min-height: 48px scrollbar thumb');
  assert(styleCss.includes('.btn-dev-mute'), 'Packaged style.css missing .btn-dev-mute');
  console.log('[PASS] Packaged style.css verified with all layout and scrollbar fixes.');

} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('\n================================================================');
console.log('PACKAGED APPLICATION INTEGRITY VERIFIED (100%)');
console.log('================================================================');
