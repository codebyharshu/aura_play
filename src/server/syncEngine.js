/**
 * SyncEngine manages high-resolution timestamping, clock synchronization (Cristian's algorithm),
 * and audio packet packaging for multi-device synchronized playback.
 */
class SyncEngine {
  constructor(options = {}) {
    // Default playout delay (buffer time) in milliseconds to absorb network jitter
    this.playoutDelayMs = options.playoutDelayMs || 80;
    this.sequenceNumber = 0;
    this.stats = {
      packetsStreamed: 0,
      bytesStreamed: 0,
      activeStreams: 0,
      lastPacketTime: 0
    };
  }

  /**
   * Generates a sync-pong response for a client time-sync ping.
   * Uses Cristian's NTP-style algorithm for sub-millisecond clock offset determination.
   *
   * @param {number} clientSendTime - t0 sent by client
   * @param {number} serverReceiveTime - t1 recorded upon message arrival
   * @returns {object} Sync response payload
   */
  createSyncResponse(clientSendTime, serverReceiveTime) {
    const serverSendTime = Date.now();
    return {
      type: 'sync-pong',
      clientSendTime,       // t0
      serverReceiveTime,    // t1
      serverSendTime,       // t2
      playoutDelayMs: this.playoutDelayMs
    };
  }

  /**
   * Packages a raw audio chunk with sequence number, timestamps, and target playout schedule.
   *
   * @param {Buffer} pcmBuffer - Raw PCM or encoded audio data
   * @param {object} format - Audio format metadata (sampleRate, channels, bitDepth)
   * @returns {{ header: object, buffer: Buffer }} Packaged audio frame
   */
  packageAudioFrame(pcmBuffer, format = { sampleRate: 48000, channels: 2, bitDepth: 16 }) {
    const now = Date.now();
    const frameSeq = this.sequenceNumber++;
    
    // Scheduled playback timestamp on the synchronized master clock
    const scheduledPlayTime = now + this.playoutDelayMs;

    this.stats.packetsStreamed++;
    this.stats.bytesStreamed += pcmBuffer.length;
    this.stats.lastPacketTime = now;

    // Header metadata sent before the binary payload
    const header = {
      type: 'audio-frame',
      seq: frameSeq,
      serverTime: now,
      scheduledPlayTime,
      format: {
        sampleRate: format.sampleRate,
        channels: format.channels,
        bitDepth: format.bitDepth
      },
      byteLength: pcmBuffer.length
    };

    return { header, buffer: pcmBuffer };
  }

  setPlayoutDelay(ms) {
    this.playoutDelayMs = Math.max(30, Math.min(500, ms));
  }

  getPlayoutDelay() {
    return this.playoutDelayMs;
  }

  getStats() {
    return {
      ...this.stats,
      playoutDelayMs: this.playoutDelayMs
    };
  }
}

module.exports = SyncEngine;
