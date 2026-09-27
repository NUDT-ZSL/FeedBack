export interface WaveStyle {
  thickness: number;
  colorOffset: number;
  brightness: number;
}

interface AnimatedStyle {
  target: WaveStyle;
  current: WaveStyle;
  startTime: number;
  duration: number;
}

function elasticEaseOut(t: number): number {
  if (t === 0 || t === 1) return t;
  const p = 0.3;
  return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      }
    : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function lerpColor(color1: string, color2: string, t: number): string {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  return rgbToHex(
    c1.r + (c2.r - c1.r) * t,
    c1.g + (c2.g - c1.g) * t,
    c1.b + (c2.b - c1.b) * t
  );
}

function shiftHue(color: string, offset: number): string {
  const rgb = hexToRgb(color);
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  h = (h + offset) % 1;
  if (h < 0) h += 1;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  if (s === 0) {
    const v = Math.round(l * 255);
    return rgbToHex(v, v, v);
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex(
    hue2rgb(p, q, h + 1 / 3) * 255,
    hue2rgb(p, q, h) * 255,
    hue2rgb(p, q, h - 1 / 3) * 255
  );
}

export class WaveRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private waveformData: Float32Array | null = null;
  private playProgress: number = 0;
  private style: AnimatedStyle;
  private animationFrameId: number | null = null;
  private dpr: number = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    this.ctx = ctx;

    this.style = {
      target: { thickness: 3, colorOffset: 0.5, brightness: 0.5 },
      current: { thickness: 3, colorOffset: 0.5, brightness: 0.5 },
      startTime: 0,
      duration: 300
    };

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

  setWaveformData(data: Float32Array): void {
    this.waveformData = data;
    this.render();
  }

  setPlayProgress(progress: number): void {
    this.playProgress = progress;
    this.render();
  }

  setStyle(style: Partial<WaveStyle>): void {
    const now = performance.now();
    this.style.current = { ...this.getCurrentStyle(now) };
    this.style.target = { ...this.style.target, ...style };
    this.style.startTime = now;
    this.startAnimation();
  }

  private getCurrentStyle(now: number): WaveStyle {
    const elapsed = now - this.style.startTime;
    const t = Math.min(1, elapsed / this.style.duration);
    const eased = elasticEaseOut(t);

    return {
      thickness: this.style.current.thickness + (this.style.target.thickness - this.style.current.thickness) * eased,
      colorOffset: this.style.current.colorOffset + (this.style.target.colorOffset - this.style.current.colorOffset) * eased,
      brightness: this.style.current.brightness + (this.style.target.brightness - this.style.current.brightness) * eased
    };
  }

  private startAnimation(): void {
    if (this.animationFrameId !== null) return;

    const animate = () => {
      const now = performance.now();
      const style = this.getCurrentStyle(now);
      this.draw(style);

      if (now - this.style.startTime < this.style.duration) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        this.style.current = { ...this.style.target };
        this.animationFrameId = null;
      }
    };
    animate();
  }

  render(): void {
    const now = performance.now();
    const style = this.getCurrentStyle(now);
    this.draw(style);
  }

  private draw(style: WaveStyle): void {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const brightnessValue = Math.round(style.brightness * 60);
    ctx.fillStyle = `rgb(${brightnessValue}, ${brightnessValue}, ${brightnessValue + 10})`;
    ctx.fillRect(0, 0, width, height);

    if (!this.waveformData || this.waveformData.length === 0) return;

    const centerY = height / 2;
    const data = this.waveformData;
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * width;
      const amplitude = data[i] * (height * 0.4);
      points.push({ x, y: centerY - amplitude });
    }

    const colorStart = shiftHue('#00bcd4', (style.colorOffset - 0.5) * 0.3);
    const colorEnd = shiftHue('#7c4dff', (style.colorOffset - 0.5) * 0.3);

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, colorStart);
    gradient.addColorStop(1, colorEnd);

    ctx.strokeStyle = gradient;
    ctx.lineWidth = style.thickness;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    if (points.length < 2) {
      ctx.moveTo(points[0]?.x ?? 0, points[0]?.y ?? centerY);
    } else {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.quadraticCurveTo(
        points[points.length - 2].x,
        points[points.length - 2].y,
        points[points.length - 1].x,
        points[points.length - 1].y
      );
    }
    ctx.stroke();

    ctx.beginPath();
    if (points.length < 2) {
      ctx.moveTo(points[0]?.x ?? 0, centerY + (centerY - (points[0]?.y ?? centerY)));
    } else {
      ctx.moveTo(points[0].x, centerY + (centerY - points[0].y));
      for (let i = 1; i < points.length - 1; i++) {
        const mirroredY = centerY + (centerY - points[i].y);
        const nextMirroredY = centerY + (centerY - points[i + 1].y);
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (mirroredY + nextMirroredY) / 2;
        ctx.quadraticCurveTo(points[i].x, mirroredY, xc, yc);
      }
      const lastMirroredY = centerY + (centerY - points[points.length - 1].y);
      const secondLastMirroredY = centerY + (centerY - points[points.length - 2].y);
      ctx.quadraticCurveTo(
        points[points.length - 2].x,
        secondLastMirroredY,
        points[points.length - 1].x,
        lastMirroredY
      );
    }
    ctx.stroke();

    const scanX = this.playProgress * width;
    ctx.save();
    ctx.strokeStyle = 'rgba(233, 69, 96, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(scanX, 0);
    ctx.lineTo(scanX, height);
    ctx.stroke();
    ctx.restore();
  }

  destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }
}
