/**
 * AudioSyncManager handles Web Audio API initialization,
 * NTP-style clock synchronization, adaptive jitter buffering,
 * and gapless scheduled chunk playback across iOS Safari, Android Chrome, and Desktop.
 */
class AudioSyncManager {
  constructor() {
    this.audioContext = null;
    this.gainNode = null;
    this.clockOffset = 0; // serverTime - localTime
    this.measuredLatency = 0; // round-trip / 2
    this.playoutDelayMs = 80;
    this.isUnlocked = false;

    // Playout timeline cursor for seamless gapless playback
    this.nextPlayTime = 0;

    // Moving average of clock offsets to smooth out network jitter
    this.offsetSamples = [];
    this.maxOffsetSamples = 8;
  }

  /**
   * Unlocks the Web Audio context. Must be invoked via a user touch/click gesture.
   * Handles iOS Safari / Android Chrome sample rate variations and state locks.
   */
  async unlockAudio() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Web Audio API is not supported in this browser.');
      }

      // Try preferred 48kHz, fallback to system native rate (e.g. 44.1kHz on iPhone)
      try {
        this.audioContext = new AudioCtx({ latencyHint: 'interactive', sampleRate: 48000 });
      } catch (err) {
        this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
      }

      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);

      // Handle iOS Safari audio interruption when locking phone or switching tabs
      this.audioContext.onstatechange = () => {
        if (this.audioContext && (this.audioContext.state === 'suspended' || this.audioContext.state === 'interrupted')) {
          const autoResume = () => {
            if (this.audioContext && this.audioContext.state !== 'running') {
              this.audioContext.resume().catch(() => {});
            }
            window.removeEventListener('click', autoResume);
            window.removeEventListener('touchstart', autoResume);
          };
          window.addEventListener('click', autoResume, { once: true });
          window.addEventListener('touchstart', autoResume, { once: true });
        }
      };
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.isUnlocked = true;
    this.nextPlayTime = 0; // reset playout cursor
    return this.audioContext.state === 'running';
  }

  setVolume(volume) {
    if (this.gainNode && this.audioContext) {
      // Smooth volume transition over 25ms to avoid zipper noise
      const targetVol = Math.max(0, Math.min(1, volume));
      this.gainNode.gain.setTargetAtTime(targetVol, this.audioContext.currentTime, 0.025);
    }
  }

  /**
   * Processes a sync-pong response from the server.
   * Cristian's Algorithm:
   * t0: client send time
   * t1: server receive time
   * t2: server send time
   * t3: client receive time (now)
   */
  handleSyncPong(data) {
    const t0 = data.clientSendTime;
    const t1 = data.serverReceiveTime;
    const t2 = data.serverSendTime;
    const t3 = Date.now();

    const roundTrip = (t3 - t0) - (t2 - t1);
    const oneWayLatency = Math.max(0, roundTrip / 2);
    const offset = ((t1 - t0) + (t2 - t3)) / 2;

    this.measuredLatency = Math.round(oneWayLatency);
    if (data.playoutDelayMs) {
      this.playoutDelayMs = data.playoutDelayMs;
    }

    // Add to offset sample window
    this.offsetSamples.push(offset);
    if (this.offsetSamples.length > this.maxOffsetSamples) {
      this.offsetSamples.shift();
    }

    // Median offset calculation to filter out transient network spikes
    const sorted = [...this.offsetSamples].sort((a, b) => a - b);
    const medianOffset = sorted[Math.floor(sorted.length / 2)];
    this.clockOffset = medianOffset;

    return {
      latencyMs: this.measuredLatency,
      clockOffsetMs: Math.round(this.clockOffset)
    };
  }

  getEstimatedServerTime() {
    return Date.now() + this.clockOffset;
  }

  /**
   * Schedules a binary PCM audio frame for gapless playback aligned with the master clock.
   *
   * @param {object} header - Header containing scheduledPlayTime and format
   * @param {ArrayBuffer} pcmBuffer - Raw PCM 16-bit interleaved stereo data
   */
  scheduleAudioChunk(header, pcmBuffer) {
    if (!this.audioContext || this.audioContext.state !== 'running') return;

    const sampleRate = header.format.sampleRate || 48000;
    const channels = header.format.channels || 2;
    const bitDepth = header.format.bitDepth || 16;

    // Convert raw 16-bit PCM bytes to Float32 AudioBuffer
    const bytesPerSample = bitDepth / 8;
    const numFrames = Math.floor(pcmBuffer.byteLength / (channels * bytesPerSample));
    if (numFrames <= 0) return;

    const audioBuffer = this.audioContext.createBuffer(channels, numFrames, sampleRate);
    const dataView = new DataView(pcmBuffer);

    if (channels === 2) {
      const leftChannel = audioBuffer.getChannelData(0);
      const rightChannel = audioBuffer.getChannelData(1);

      for (let i = 0; i < numFrames; i++) {
        const offset = i * 4;
        leftChannel[i] = dataView.getInt16(offset, true) / 32768.0;
        rightChannel[i] = dataView.getInt16(offset + 2, true) / 32768.0;
      }
    } else {
      const monoChannel = audioBuffer.getChannelData(0);
      for (let i = 0; i < numFrames; i++) {
        monoChannel[i] = dataView.getInt16(i * 2, true) / 32768.0;
      }
    }

    // Synchronize playout time
    const currentServerTime = this.getEstimatedServerTime();
    const scheduledPlayTime = header.scheduledPlayTime;
    const deltaMs = scheduledPlayTime - currentServerTime;
    const targetPlayContextTime = this.audioContext.currentTime + Math.max(0.02, deltaMs / 1000);

    // Continuous timeline scheduler: eliminates micro-gaps and clicks
    if (this.nextPlayTime < this.audioContext.currentTime) {
      // Stream start or buffer underrun recovery
      this.nextPlayTime = targetPlayContextTime;
    } else {
      // Check drift between timeline and target clock
      const drift = this.nextPlayTime - targetPlayContextTime;
      if (Math.abs(drift) > 0.040) {
        // Gentle proportional slew (10%) to stay synchronized without audio pitch jumps
        this.nextPlayTime -= drift * 0.10;
      }
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);
    source.start(this.nextPlayTime);

    // Advance timeline exactly by buffer duration
    this.nextPlayTime += audioBuffer.duration;
  }
}

window.AudioSyncManager = AudioSyncManager;
