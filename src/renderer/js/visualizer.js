class AudioVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.barCount = 48;
    this.frequencyData = new Float32Array(this.barCount);
    this.targetData = new Float32Array(this.barCount);
    this.isBroadcasting = false;
    this.animationFrameId = null;

    this.vuLeft = document.getElementById('vuBarLeft');
    this.vuRight = document.getElementById('vuBarRight');

    this.initCanvasSize();
    this.startLoop();
  }

  initCanvasSize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    if (this.ctx) {
      this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
  }

  setBroadcasting(broadcasting) {
    this.isBroadcasting = broadcasting;
  }

  updateAudioData(pcmOrFrequencies) {
    if (!pcmOrFrequencies) return;
    // Calculate RMS and spectrum values from incoming PCM
    let sum = 0;
    const step = Math.floor(pcmOrFrequencies.length / this.barCount) || 1;
    for (let i = 0; i < this.barCount; i++) {
      const idx = i * step;
      const val = Math.abs(pcmOrFrequencies[idx] || 0);
      sum += val;
      this.targetData[i] = Math.min(1.0, val * 1.5);
    }

    const rms = Math.min(1.0, (sum / this.barCount) * 2.0);
    if (this.vuLeft) this.vuLeft.style.width = `${Math.min(100, rms * 100)}%`;
    if (this.vuRight) this.vuRight.style.width = `${Math.min(100, rms * 95)}%`;
  }

  startLoop() {
    let t = 0;

    const render = () => {
      this.animationFrameId = requestAnimationFrame(render);
      if (!this.ctx || !this.canvas) return;

      const w = this.canvas.width / window.devicePixelRatio;
      const h = this.canvas.height / window.devicePixelRatio;
      this.ctx.clearRect(0, 0, w, h);

      t += 0.04;

      // Smooth interpolation
      for (let i = 0; i < this.barCount; i++) {
        if (!this.isBroadcasting) {
          // Ambient breathing wave when idle
          const wave = Math.sin(t + i * 0.2) * 0.15 + 0.18;
          this.frequencyData[i] += (wave - this.frequencyData[i]) * 0.08;
        } else {
          this.frequencyData[i] += (this.targetData[i] - this.frequencyData[i]) * 0.25;
          this.targetData[i] *= 0.88; // decay
        }
      }

      const barWidth = (w / this.barCount) * 0.72;
      const spacing = (w - (barWidth * this.barCount)) / (this.barCount - 1);

      // Draw Spectrum Bars
      for (let i = 0; i < this.barCount; i++) {
        const val = this.frequencyData[i];
        const barHeight = Math.max(3, val * (h - 20));
        const x = i * (barWidth + spacing);
        const y = h - barHeight - 12;

        // Gradient color based on frequency index
        const grad = this.ctx.createLinearGradient(0, y, 0, h);
        const ratio = i / this.barCount;
        if (ratio < 0.4) {
          grad.addColorStop(0, '#00f2fe');
          grad.addColorStop(1, 'rgba(0, 242, 254, 0.2)');
        } else if (ratio < 0.75) {
          grad.addColorStop(0, '#8b5cf6');
          grad.addColorStop(1, 'rgba(139, 92, 246, 0.2)');
        } else {
          grad.addColorStop(0, '#f43f5e');
          grad.addColorStop(1, 'rgba(244, 63, 94, 0.2)');
        }

        this.ctx.fillStyle = grad;
        this.ctx.beginPath();
        this.ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
        this.ctx.fill();

        // Top glow cap
        if (this.isBroadcasting && val > 0.1) {
          this.ctx.fillStyle = '#ffffff';
          this.ctx.fillRect(x, y - 2, barWidth, 2);
        }
      }

      // Draw subtle wave line across top
      this.ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      for (let i = 0; i < this.barCount; i++) {
        const val = this.frequencyData[i];
        const x = i * (barWidth + spacing) + barWidth / 2;
        const y = h - (val * (h - 20)) - 14;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();
    };

    render();
  }
}

window.AudioVisualizer = AudioVisualizer;
