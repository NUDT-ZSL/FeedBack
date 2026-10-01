interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface BarState {
  targetHeight: number;
  currentHeight: number;
  active: boolean;
  lastActiveTime: number;
}

export class VisualizerModule {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserNode;
  private frequencyData: Uint8Array;
  private particles: Particle[] = [];
  private barStates: BarState[] = [];
  private running: boolean = false;
  private lastFrameTime: number = 0;
  private frameInterval: number = 1000 / 30;
  private animationId: number = 0;
  private barCount: number = 32;
  private glowPhase: number = 0;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取Canvas 2D上下文');
    this.ctx = ctx;
    this.analyser = analyser;
    this.frequencyData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    this.resize();

    for (let i = 0; i < this.barCount; i++) {
      this.barStates.push({
        targetHeight: 0,
        currentHeight: 0,
        active: false,
        lastActiveTime: 0,
      });
    }
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.animate();
  }

  stop(): void {
    this.running = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
  }

  triggerParticles(activeIndices: number[]): void {
    const rect = this.canvas.getBoundingClientRect();
    const barWidth = rect.width / this.barCount;

    for (const idx of activeIndices) {
      if (idx < 0 || idx >= this.barCount) continue;
      const barCenterX = idx * barWidth + barWidth / 2;
      const barHeight = this.barStates[idx]?.currentHeight || 0;
      const startY = rect.height - barHeight;

      for (let i = 0; i < 30; i++) {
        const angle = (Math.random() - 0.5) * Math.PI * 0.8;
        const speed = 40 + Math.random() * 120;
        this.particles.push({
          x: barCenterX + (Math.random() - 0.5) * barWidth * 0.8,
          y: startY,
          vx: Math.sin(angle) * speed,
          vy: -Math.cos(angle) * speed - 30,
          life: 1.0,
          maxLife: 1.0,
          color: this.getColor(1 - barHeight / rect.height),
          size: 2 + Math.random() * 3,
        });
      }
    }
  }

  private getColor(t: number): string {
    const clamped = Math.max(0, Math.min(1, t));
    const r = Math.floor(33 + (244 - 33) * clamped);
    const g = Math.floor(150 + (67 - 150) * clamped);
    const b = Math.floor(243 + (54 - 243) * clamped);
    return `rgb(${r}, ${g}, ${b})`;
  }

  private getGradient(ctx: CanvasRenderingContext2D, height: number): CanvasGradient {
    const rect = this.canvas.getBoundingClientRect();
    const gradient = ctx.createLinearGradient(0, rect.height, 0, rect.height - height);
    gradient.addColorStop(0, '#2196f3');
    gradient.addColorStop(0.4, '#5e35b1');
    gradient.addColorStop(1, '#f44336');
    return gradient;
  }

  private animate = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const delta = (now - this.lastFrameTime) / 1000;

    if (now - this.lastFrameTime >= this.frameInterval) {
      this.lastFrameTime = now;
      this.render(delta);
    }

    this.animationId = requestAnimationFrame(this.animate);
  };

  private render(delta: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const ctx = this.ctx;

    ctx.clearRect(0, 0, rect.width, rect.height);

    this.analyser.getByteFrequencyData(this.frequencyData);

    const barWidth = rect.width / this.barCount;
    const gap = 2;
    const activeBars: number[] = [];

    this.glowPhase = (this.glowPhase + delta * 2) % (Math.PI * 2);

    for (let i = 0; i < this.barCount; i++) {
      const dataIndex = Math.floor((i / this.barCount) * this.frequencyData.length * 0.7);
      const value = this.frequencyData[dataIndex] || 0;
      const targetHeight = (value / 255) * rect.height * 0.95;

      const state = this.barStates[i];
      state.targetHeight = targetHeight;
      state.currentHeight += (targetHeight - state.currentHeight) * Math.min(1, delta * 10);

      const wasActive = state.active;
      state.active = state.currentHeight > rect.height * 0.15;

      if (state.active && !wasActive) {
        state.lastActiveTime = performance.now();
        if (value > 100) {
          activeBars.push(i);
        }
      }

      const x = i * barWidth + gap / 2;
      const w = barWidth - gap;
      const h = Math.max(2, state.currentHeight);
      const y = rect.height - h;

      if (state.active) {
        ctx.shadowColor = this.getColor(h / rect.height);
        ctx.shadowBlur = 15;
      } else {
        ctx.shadowBlur = 0;
      }

      const flicker = state.active ? 1 : 0.3 + Math.sin(this.glowPhase + i * 0.5) * 0.1;
      ctx.globalAlpha = flicker;

      ctx.fillStyle = this.getGradient(ctx, h);
      this.roundRect(ctx, x, y, w, h, 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    if (activeBars.length > 0) {
      this.triggerParticles(activeBars);
    }

    this.updateParticles(delta, rect.height);
    this.renderParticles(ctx);
  }

  private updateParticles(delta: number, canvasHeight: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy += 200 * delta;
      p.life -= delta;
      if (p.life <= 0 || p.y > canvasHeight + 10) {
        this.particles.splice(i, 1);
      }
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  destroy(): void {
    this.stop();
    this.particles = [];
  }
}
