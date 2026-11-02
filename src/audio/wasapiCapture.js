const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');

function resolveNativeExePath(customPath) {
  // If explicitly provided and outside asar archive
  if (customPath && !customPath.includes('app.asar')) {
    try {
      if (fs.existsSync(customPath)) return customPath;
    } catch (e) {}
  }

  const candidates = [];

  // 1. Packaged Electron paths (outside app.asar)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'src', 'audio', 'native', 'SyncWaveLoopback.exe'));
    candidates.push(path.join(process.resourcesPath, 'native-audio', 'SyncWaveLoopback.exe'));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'audio', 'native', 'SyncWaveLoopback.exe'));
  }

  // 2. If __dirname is inside app.asar, check app.asar.unpacked directory
  if (__dirname.includes('app.asar')) {
    const unpackedDir = __dirname.replace('app.asar', 'app.asar.unpacked');
    candidates.push(path.join(unpackedDir, 'native', 'SyncWaveLoopback.exe'));
  }

  // 3. Development path (only when running unpacked in dev)
  const devPath = path.join(__dirname, 'native', 'SyncWaveLoopback.exe');
  if (!devPath.includes('app.asar')) {
    candidates.push(devPath);
  }

  // Find the first valid candidate that actually exists on the filesystem
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        console.log(`[WasapiCapture] Resolved native worker binary at: ${candidate}`);
        return candidate;
      }
    } catch (e) {}
  }

  // Fallback outside asar
  if (process.resourcesPath) {
    return path.join(process.resourcesPath, 'src', 'audio', 'native', 'SyncWaveLoopback.exe');
  }
  return devPath.replace('app.asar', 'app.asar.unpacked');
}

class WasapiCapture extends EventEmitter {
  constructor(options = {}) {
    super();
    this.exePath = resolveNativeExePath(options.exePath);
    this.process = null;
    this.isCapturing = false;
    this.format = {
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16
    };
    this.deviceName = 'Default Playback Device';
    this.bytesCaptured = 0;
    this.lastDataTime = 0;

    // ~20ms frames at 48kHz 16-bit stereo
    this.targetChunkBytes = options.chunkBytes || 3840;
    this.accumulatedBuffer = Buffer.alloc(0);
    this.silenceTimer = null;
  }

  async start() {
    if (this.isCapturing) return true;

    if (!fs.existsSync(this.exePath)) {
      throw new Error(`WASAPI Loopback executable not found at: ${this.exePath}`);
    }

    return new Promise((resolve, reject) => {
      let started = false;
      const cwd = path.dirname(this.exePath);

      try {
        this.process = spawn(this.exePath, [], {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        });
      } catch (err) {
        return reject(new Error('Failed to spawn WASAPI capture worker: ' + err.message));
      }

      this.process.stdout.on('data', (chunk) => {
        this.handlePcmData(chunk);
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString('utf-8');
        const lines = text.split(/\r?\n/);

        for (const line of lines) {
          if (!line.trim()) continue;

          if (line.includes('[INFO]')) {
            const devMatch = line.match(/Device:\s*"([^"]+)"/);
            if (devMatch) this.deviceName = devMatch[1];
          }

          if (line.includes('[SYNCWAVE_FORMAT]')) {
            const srMatch = line.match(/SampleRate=(\d+)/);
            const chMatch = line.match(/Channels=(\d+)/);
            if (srMatch) this.format.sampleRate = parseInt(srMatch[1], 10);
            if (chMatch) this.format.channels = parseInt(chMatch[1], 10);
          }

          if (line.includes('[SYNCWAVE_STATUS] STARTED')) {
            this.isCapturing = true;
            started = true;
            this.startSilenceGenerator();
            this.emit('started', { deviceName: this.deviceName, format: this.format });
            resolve(true);
          }

          if (line.includes('[SYNCWAVE_ERROR]')) {
            const errorMsg = line.replace('[SYNCWAVE_ERROR]', '').trim();
            this.emit('error', new Error(errorMsg));
            if (!started) {
              reject(new Error(errorMsg));
            }
          }
        }
      });

      this.process.on('close', (code) => {
        this.isCapturing = false;
        this.stopSilenceGenerator();
        this.process = null;
        this.emit('stopped', { exitCode: code });
        if (!started) {
          reject(new Error(`WASAPI capture process exited with code ${code}`));
        }
      });

      this.process.on('error', (err) => {
        this.isCapturing = false;
        this.stopSilenceGenerator();
        this.emit('error', err);
        if (!started) reject(err);
      });

      // Timeout safety
      setTimeout(() => {
        if (!started) {
          this.stop();
          reject(new Error('Timed out waiting for WASAPI capture engine to start'));
        }
      }, 5000);
    });
  }

  handlePcmData(chunk) {
    this.bytesCaptured += chunk.length;
    this.lastDataTime = Date.now();

    // Accumulate incoming audio bytes
    this.accumulatedBuffer = Buffer.concat([this.accumulatedBuffer, chunk]);

    // Emit in consistent packet sizes
    while (this.accumulatedBuffer.length >= this.targetChunkBytes) {
      const frameBuffer = this.accumulatedBuffer.subarray(0, this.targetChunkBytes);
      this.accumulatedBuffer = this.accumulatedBuffer.subarray(this.targetChunkBytes);

      // Emit raw PCM frame for streaming
      this.emit('audio-frame', {
        buffer: frameBuffer,
        format: this.format
      });

      // Compute visualizer values from PCM frame
      this.generateVisualizerSamples(frameBuffer);
    }
  }

  /**
   * Generates normalized FFT / amplitude samples for the desktop visualizer canvas.
   */
  generateVisualizerSamples(pcmBuffer) {
    const numSamples = pcmBuffer.length / 2; // 16-bit
    const barCount = 48;
    const step = Math.floor(numSamples / barCount) || 1;
    const amplitudes = new Float32Array(barCount);

    for (let i = 0; i < barCount; i++) {
      const sampleIdx = i * step * 2;
      if (sampleIdx + 1 < pcmBuffer.length) {
        const val16 = pcmBuffer.readInt16LE(sampleIdx);
        amplitudes[i] = Math.abs(val16) / 32768.0;
      }
    }

    this.emit('visualizer-data', Array.from(amplitudes));
  }

  /**
   * Silence Keepalive: When all Windows applications are silent, Windows pauses
   * the WASAPI mixer clock. This timer produces periodic zero-PCM frames every 60ms
   * to keep mobile receiver audio clocks continuously in sync without drift.
   */
  startSilenceGenerator() {
    this.stopSilenceGenerator();
    this.silenceTimer = setInterval(() => {
      if (this.isCapturing && (Date.now() - this.lastDataTime > 120)) {
        const silenceFrame = Buffer.alloc(this.targetChunkBytes, 0);
        this.emit('audio-frame', {
          buffer: silenceFrame,
          format: this.format
        });
        this.emit('visualizer-data', new Array(48).fill(0));
      }
    }, 60);
  }

  stopSilenceGenerator() {
    if (this.silenceTimer) {
      clearInterval(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  async stop() {
    this.stopSilenceGenerator();

    if (!this.isCapturing || !this.process) {
      this.isCapturing = false;
      return true;
    }

    return new Promise((resolve) => {
      const proc = this.process;
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        this.isCapturing = false;
        this.process = null;
        resolve(true);
      };

      proc.once('close', finish);

      try {
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write('STOP\n');
          proc.stdin.end();
        }
      } catch (err) {
        console.error('Error writing STOP to WASAPI process:', err);
      }

      // Force kill fallback if not closed within 1.5s
      setTimeout(() => {
        try {
          if (proc && !proc.killed) {
            proc.kill();
          }
        } catch (e) {}
        finish();
      }, 1500);
    });
  }

  getStatus() {
    return {
      isCapturing: this.isCapturing,
      deviceName: this.deviceName,
      format: this.format,
      bytesCaptured: this.bytesCaptured,
      lastDataTime: this.lastDataTime
    };
  }
}

module.exports = WasapiCapture;
