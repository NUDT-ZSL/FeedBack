const BAR_COUNT = 64;
const BAR_WIDTH = 4;
const BAR_GAP = 2;

export class SpectrumRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frequencyData: Uint8Array | null = null;
  private smoothedHeights: number[] = new Array(BAR_COUNT).fill(0);
  private dpr: number = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    this.ctx = ctx;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
    this.render();
  }

  setFrequencyData(data: Uint8Array): void {
    this.frequencyData = data;
    this.render();
  }

  private getBarColor(index: number, total: number): string {
    const ratio = index / (total - 1);
    if (ratio < 0.33) {
      return '#ff5722';
    } else if (ratio < 0.66) {
      return '#9c27b0';
    } else {
      return '#2196f3';
    }
  }

  private interpolateColor(color1: string, color2: string, t: number): string {
    const hex = (x: string) => parseInt(x, 16);
    const r1 = hex(color1.slice(1, 3)), g1 = hex(color1.slice(3, 5)), b1 = hex(color1.slice(5, 7));
    const r2 = hex(color2.slice(1, 3)), g2 = hex(color2.slice(3, 5)), b2 = hex(color2.slice(5, 7));
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  render(): void {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, width, height);

    const totalBarWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
    const startX = (width - totalBarWidth) / 2;
    const bottomY = height - 20;
    const maxHeight = height - 40;

    if (!this.frequencyData) {
      for (let i = 0; i < BAR_COUNT; i++) {
        this.smoothedHeights[i] *= 0.95;
        if (this.smoothedHeights[i] < 0.5) this.smoothedHeights[i] = 0;
        const x = startX + i * (BAR_WIDTH + BAR_GAP);
        const barHeight = this.smoothedHeights[i] * maxHeight;
        const color = this.getBarColor(i, BAR_COUNT);
        ctx.fillStyle = color;
        ctx.fillRect(x, bottomY - barHeight, BAR_WIDTH, barHeight);
        if (barHeight > 2) {
          const lighter = this.interpolateColor(color, '#ffffff', 0.3);
          ctx.fillStyle = lighter;
          ctx.fillRect(x, bottomY - barHeight, BAR_WIDTH, 2);
        }
      }
      this.drawGlow(startX, bottomY, maxHeight);
      return;
    }

    const freqData = this.frequencyData;
    const binSize = Math.floor(freqData.length / BAR_COUNT);

    for (let i = 0; i < BAR_COUNT; i++) {
      let sum = 0;
      for (let j = 0; j < binSize; j++) {
        sum += freqData[i * binSize + j] || 0;
      }
      const avg = sum / binSize / 255;
      this.smoothedHeights[i] = this.smoothedHeights[i] * 0.7 + avg * 0.3;

      const x = startX + i * (BAR_WIDTH + BAR_GAP);
      const barHeight = this.smoothedHeights[i] * maxHeight;

      const color = this.getBarColor(i, BAR_COUNT);

      const gradient = ctx.createLinearGradient(x, bottomY, x, bottomY - barHeight);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, this.interpolateColor(color, '#ffffff', 0.4));

      ctx.fillStyle = gradient;
      ctx.fillRect(x, bottomY - barHeight, BAR_WIDTH, barHeight);

      if (barHeight > 2) {
        const lighter = this.interpolateColor(color, '#ffffff', 0.5);
        ctx.fillStyle = lighter;
        ctx.fillRect(x, bottomY - barHeight, BAR_WIDTH, 2);
      }
    }

    this.drawGlow(startX, bottomY, maxHeight);
  }

  private drawGlow(startX: number, bottomY: number, maxHeight: number): void {
    const ctx = this.ctx;
    const totalBarWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
    const centerX = startX + totalBarWidth / 2;
    const glowY = bottomY - maxHeight * 0.3;

    const avgHeight = this.smoothedHeights.reduce((a, b) => a + b, 0) / this.smoothedHeights.length;
    const glowIntensity = Math.min(0.6, 0.2 + avgHeight * 0.8);

    const gradient = ctx.createRadialGradient(
      centerX, glowY, 0,
      centerX, glowY, totalBarWidth * 0.6
    );
    gradient.addColorStop(0, `rgba(156, 39, 176, ${glowIntensity})`);
    gradient.addColorStop(0.5, `rgba(33, 150, 243, ${glowIntensity * 0.5})`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, glowY, totalBarWidth * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
