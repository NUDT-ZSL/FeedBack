export interface Skeleton {
  paths: string[];
  bounds: { x: number; y: number; width: number; height: number };
}

export interface SilkColor {
  primary: string;
  secondary: string;
  opacity: number;
}

export interface BrushStroke {
  points: { x: number; y: number }[];
  color: string;
  radius: number;
}

export interface Line {
  start: { x: number; y: number };
  end: { x: number; y: number };
  color: string;
  radius: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

export class LanternRenderer {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public offscreenCanvas: HTMLCanvasElement;
  public offscreenCtx: CanvasRenderingContext2D;
  public animationId: number | null = null;
  public particles: Particle[] = [];
  public isLighting: boolean = false;
  public lightProgress: number = 0;
  public lightColor: string = '#ffe8b0';
  public skeletonPaths: Path2D[] = [];

  private skeleton: Skeleton | null = null;
  private silkColor: SilkColor | null = null;
  private strokes: BrushStroke[] = [];
  private lines: Line[] = [];
  private temporaryStroke: { points: { x: number; y: number }[]; color: string; radius: number } | null = null;
  private temporaryLine: { start: { x: number; y: number }; end: { x: number; y: number }; color: string; radius: number } | null = null;
  private currentAudioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private cachedSkeletonKey: string = '';
  private tempPoint: { x: number; y: number } = { x: 0, y: 0 };

  private static readonly CANVAS_SIZE = 400;
  private static readonly ANIMATION_DURATION = 2000;
  private static readonly PARTICLE_MIN = 40;
  private static readonly PARTICLE_MAX = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;

    this.canvas.width = LanternRenderer.CANVAS_SIZE;
    this.canvas.height = LanternRenderer.CANVAS_SIZE;

    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = LanternRenderer.CANVAS_SIZE;
    this.offscreenCanvas.height = LanternRenderer.CANVAS_SIZE;
    const offscreenCtx = this.offscreenCanvas.getContext('2d');
    if (!offscreenCtx) {
      throw new Error('Failed to get offscreen 2D rendering context');
    }
    this.offscreenCtx = offscreenCtx;
  }

  public drawSkeleton(skeleton: Skeleton): void {
    this.clear();
    this.skeleton = skeleton;

    const key = skeleton.paths.join('|');
    if (key !== this.cachedSkeletonKey) {
      this.skeletonPaths = skeleton.paths.map(d => this.parsePathD(d));
      this.cachedSkeletonKey = key;
    }

    this.ctx.save();
    this.ctx.strokeStyle = '#b87333';
    this.ctx.lineWidth = 2;
    this.ctx.globalAlpha = 0.6;

    for (let i = 0; i < this.skeletonPaths.length; i++) {
      this.ctx.stroke(this.skeletonPaths[i]);
    }

    this.ctx.restore();
  }

  public drawSilk(color: SilkColor): void {
    if (this.skeletonPaths.length === 0) return;

    this.silkColor = color;

    const offCtx = this.offscreenCtx;
    offCtx.clearRect(0, 0, LanternRenderer.CANVAS_SIZE, LanternRenderer.CANVAS_SIZE);

    offCtx.save();
    for (let i = 0; i < this.skeletonPaths.length; i++) {
      offCtx.clip(this.skeletonPaths[i]);
    }

    const rgb = this.hexToRgb(color.primary);
    offCtx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${color.opacity})`;
    offCtx.fillRect(0, 0, LanternRenderer.CANVAS_SIZE, LanternRenderer.CANVAS_SIZE);

    offCtx.strokeStyle = `rgba(255, 255, 255, 0.08)`;
    offCtx.lineWidth = 1;

    const step = 8;
    for (let x = 0; x < LanternRenderer.CANVAS_SIZE; x += step) {
      offCtx.beginPath();
      offCtx.moveTo(x, 0);
      offCtx.lineTo(x, LanternRenderer.CANVAS_SIZE);
      offCtx.stroke();
    }

    for (let y = 0; y < LanternRenderer.CANVAS_SIZE; y += step) {
      offCtx.beginPath();
      offCtx.moveTo(0, y);
      offCtx.lineTo(LanternRenderer.CANVAS_SIZE, y);
      offCtx.stroke();
    }

    const crossStep = 16;
    offCtx.strokeStyle = `rgba(255, 255, 255, 0.04)`;
    for (let x = -LanternRenderer.CANVAS_SIZE; x < LanternRenderer.CANVAS_SIZE * 2; x += crossStep) {
      offCtx.beginPath();
      offCtx.moveTo(x, 0);
      offCtx.lineTo(x + LanternRenderer.CANVAS_SIZE, LanternRenderer.CANVAS_SIZE);
      offCtx.stroke();
    }

    offCtx.restore();

    this.ctx.drawImage(this.offscreenCanvas, 0, 0);
  }

  public drawStrokes(strokes: BrushStroke[], lines: Line[]): void {
    if (this.skeletonPaths.length === 0) return;

    this.strokes = strokes;
    this.lines = lines;

    this.ctx.save();

    for (let i = 0; i < this.skeletonPaths.length; i++) {
      this.ctx.clip(this.skeletonPaths[i]);
    }

    for (let i = 0; i < strokes.length; i++) {
      const stroke = strokes[i];
      if (stroke.points.length < 2) continue;

      this.ctx.fillStyle = stroke.color;
      this.ctx.strokeStyle = stroke.color;
      this.ctx.lineWidth = stroke.radius * 2;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';

      const pt = this.tempPoint;
      pt.x = stroke.points[0].x;
      pt.y = stroke.points[0].y;

      this.ctx.beginPath();
      this.ctx.arc(pt.x, pt.y, stroke.radius, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.moveTo(pt.x, pt.y);

      for (let j = 1; j < stroke.points.length; j++) {
        const p = stroke.points[j];
        this.ctx.lineTo(p.x, p.y);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, stroke.radius, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      this.ctx.strokeStyle = line.color;
      this.ctx.lineWidth = line.radius * 2;
      this.ctx.lineCap = 'round';

      this.ctx.beginPath();
      this.ctx.moveTo(line.start.x, line.start.y);
      this.ctx.lineTo(line.end.x, line.end.y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  public drawTemporaryStroke(points: { x: number; y: number }[], color: string, radius: number): void {
    if (points.length === 0 || this.skeletonPaths.length === 0) return;

    this.temporaryStroke = { points, color, radius };

    this.ctx.save();

    for (let i = 0; i < this.skeletonPaths.length; i++) {
      this.ctx.clip(this.skeletonPaths[i]);
    }

    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = radius * 2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    const pt = this.tempPoint;
    pt.x = points[0].x;
    pt.y = points[0].y;

    this.ctx.beginPath();
    this.ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    this.ctx.fill();

    if (points.length > 1) {
      this.ctx.beginPath();
      this.ctx.moveTo(pt.x, pt.y);

      for (let j = 1; j < points.length; j++) {
        const p = points[j];
        this.ctx.lineTo(p.x, p.y);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
      }
    }

    this.ctx.restore();
  }

  public drawTemporaryLine(start: { x: number; y: number }, end: { x: number; y: number }, color: string, radius: number): void {
    if (this.skeletonPaths.length === 0) return;

    this.temporaryLine = { start, end, color, radius };

    this.ctx.save();

    for (let i = 0; i < this.skeletonPaths.length; i++) {
      this.ctx.clip(this.skeletonPaths[i]);
    }

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = radius * 2;
    this.ctx.lineCap = 'round';

    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    this.ctx.lineTo(end.x, end.y);
    this.ctx.stroke();

    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.beginPath();
    this.ctx.arc(end.x, end.y, radius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
  }

  public startLightingAnimation(onComplete?: () => void): void {
    if (this.isLighting) return;

    this.isLighting = true;
    this.lightProgress = 0;
    this.particles = [];

    const centerX = LanternRenderer.CANVAS_SIZE / 2;
    const centerY = LanternRenderer.CANVAS_SIZE / 2;
    const radius = 150;

    const particleCount = LanternRenderer.PARTICLE_MIN +
      Math.floor(Math.random() * (LanternRenderer.PARTICLE_MAX - LanternRenderer.PARTICLE_MIN));

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
      const r = radius * (0.8 + Math.random() * 0.3);
      const life = 1 + Math.random() * 1;

      this.particles.push({
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r * 0.6,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.5 - Math.random() * 1.5,
        size: 2 + Math.random() * 4,
        alpha: 1,
        life: life,
        maxLife: life,
      });
    }

    const startTime = performance.now();
    const duration = LanternRenderer.ANIMATION_DURATION;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      this.lightProgress = Math.min(elapsed / duration, 1);

      if (this.lightProgress < 0.33) {
        const t = this.lightProgress / 0.33;
        this.lightColor = this.lerpColor('#330000', '#ff8800', t);
      } else if (this.lightProgress < 0.66) {
        const t = (this.lightProgress - 0.33) / 0.33;
        this.lightColor = this.lerpColor('#ff8800', '#ffe8b0', t);
      } else {
        this.lightColor = '#ffe8b0';
      }

      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.02;
        p.life -= 0.016;
        p.alpha = Math.max(0, p.life / p.maxLife);
      }

      this.render();

      if (this.lightProgress < 1) {
        this.animationId = requestAnimationFrame(animate);
      } else {
        this.isLighting = false;
        this.animationId = null;
        this.particles = [];
        if (onComplete) {
          onComplete();
        }
      }
    };

    this.animationId = requestAnimationFrame(animate);
  }

  public stopAnimation(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.isLighting = false;
    this.particles = [];
  }

  public render(): void {
    this.clear();

    if (this.skeleton) {
      this.ctx.save();
      this.ctx.strokeStyle = '#b87333';
      this.ctx.lineWidth = 2;
      this.ctx.globalAlpha = 0.6;

      for (let i = 0; i < this.skeletonPaths.length; i++) {
        this.ctx.stroke(this.skeletonPaths[i]);
      }

      this.ctx.restore();
    }

    if (this.silkColor) {
      this.drawSilk(this.silkColor);
    }

    if (this.strokes.length > 0 || this.lines.length > 0) {
      this.drawStrokes(this.strokes, this.lines);
    }

    if (this.temporaryStroke) {
      this.drawTemporaryStroke(
        this.temporaryStroke.points,
        this.temporaryStroke.color,
        this.temporaryStroke.radius
      );
    }

    if (this.temporaryLine) {
      this.drawTemporaryLine(
        this.temporaryLine.start,
        this.temporaryLine.end,
        this.temporaryLine.color,
        this.temporaryLine.radius
      );
    }

    if (this.isLighting && this.particles.length > 0) {
      const rgb = this.hexToRgb(this.lightColor);

      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';

      const centerX = LanternRenderer.CANVAS_SIZE / 2;
      const centerY = LanternRenderer.CANVAS_SIZE / 2;
      const gradient = this.ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, 200 * this.lightProgress
      );
      gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.4 * this.lightProgress})`);
      gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(0, 0, LanternRenderer.CANVAS_SIZE, LanternRenderer.CANVAS_SIZE);

      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        this.ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${p.alpha * 0.8})`;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fill();

        const glowGradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
        glowGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${p.alpha * 0.4})`);
        glowGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        this.ctx.fillStyle = glowGradient;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        this.ctx.fill();
      }

      this.ctx.restore();
    }
  }

  public clear(): void {
    this.ctx.clearRect(0, 0, LanternRenderer.CANVAS_SIZE, LanternRenderer.CANVAS_SIZE);
  }

  public exportPNG(size = { w: 512, h: 512 }, transparent = true): string {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = size.w;
    tempCanvas.height = size.h;
    const tempCtx = tempCanvas.getContext('2d');

    if (!tempCtx) {
      throw new Error('Failed to get temporary canvas context');
    }

    if (!transparent) {
      tempCtx.fillStyle = '#ffffff';
      tempCtx.fillRect(0, 0, size.w, size.h);
    }

    const scaleX = size.w / LanternRenderer.CANVAS_SIZE;
    const scaleY = size.h / LanternRenderer.CANVAS_SIZE;

    tempCtx.save();
    tempCtx.scale(scaleX, scaleY);

    if (this.skeleton) {
      tempCtx.strokeStyle = '#b87333';
      tempCtx.lineWidth = 2;
      tempCtx.globalAlpha = 0.6;

      for (let i = 0; i < this.skeletonPaths.length; i++) {
        tempCtx.stroke(this.skeletonPaths[i]);
      }

      tempCtx.globalAlpha = 1;
    }

    if (this.silkColor && this.skeletonPaths.length > 0) {
      tempCtx.save();
      for (let i = 0; i < this.skeletonPaths.length; i++) {
        tempCtx.clip(this.skeletonPaths[i]);
      }

      const rgb = this.hexToRgb(this.silkColor.primary);
      tempCtx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this.silkColor.opacity})`;
      tempCtx.fillRect(0, 0, LanternRenderer.CANVAS_SIZE, LanternRenderer.CANVAS_SIZE);

      tempCtx.strokeStyle = `rgba(255, 255, 255, 0.08)`;
      tempCtx.lineWidth = 1;

      const step = 8;
      for (let x = 0; x < LanternRenderer.CANVAS_SIZE; x += step) {
        tempCtx.beginPath();
        tempCtx.moveTo(x, 0);
        tempCtx.lineTo(x, LanternRenderer.CANVAS_SIZE);
        tempCtx.stroke();
      }

      for (let y = 0; y < LanternRenderer.CANVAS_SIZE; y += step) {
        tempCtx.beginPath();
        tempCtx.moveTo(0, y);
        tempCtx.lineTo(LanternRenderer.CANVAS_SIZE, y);
        tempCtx.stroke();
      }

      tempCtx.restore();
    }

    if (this.skeletonPaths.length > 0) {
      tempCtx.save();
      for (let i = 0; i < this.skeletonPaths.length; i++) {
        tempCtx.clip(this.skeletonPaths[i]);
      }

      for (let i = 0; i < this.strokes.length; i++) {
        const stroke = this.strokes[i];
        if (stroke.points.length < 2) continue;

        tempCtx.fillStyle = stroke.color;
        tempCtx.strokeStyle = stroke.color;
        tempCtx.lineWidth = stroke.radius * 2;
        tempCtx.lineCap = 'round';
        tempCtx.lineJoin = 'round';

        const firstPt = stroke.points[0];
        tempCtx.beginPath();
        tempCtx.arc(firstPt.x, firstPt.y, stroke.radius, 0, Math.PI * 2);
        tempCtx.fill();

        tempCtx.beginPath();
        tempCtx.moveTo(firstPt.x, firstPt.y);

        for (let j = 1; j < stroke.points.length; j++) {
          const p = stroke.points[j];
          tempCtx.lineTo(p.x, p.y);
          tempCtx.stroke();

          tempCtx.beginPath();
          tempCtx.arc(p.x, p.y, stroke.radius, 0, Math.PI * 2);
          tempCtx.fill();

          tempCtx.beginPath();
          tempCtx.moveTo(p.x, p.y);
        }
      }

      for (let i = 0; i < this.lines.length; i++) {
        const line = this.lines[i];
        tempCtx.strokeStyle = line.color;
        tempCtx.lineWidth = line.radius * 2;
        tempCtx.lineCap = 'round';

        tempCtx.beginPath();
        tempCtx.moveTo(line.start.x, line.start.y);
        tempCtx.lineTo(line.end.x, line.end.y);
        tempCtx.stroke();
      }

      tempCtx.restore();
    }

    tempCtx.restore();

    return tempCanvas.toDataURL('image/png');
  }

  public generateBurnSound(): void {
    if (!this.currentAudioContext) {
      this.currentAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const ctx = this.currentAudioContext;
    const duration = 2;
    const sampleRate = ctx.sampleRate;
    const bufferSize = Math.floor(sampleRate * duration);

    if (!this.audioBuffer || this.audioBuffer.length !== bufferSize) {
      this.audioBuffer = ctx.createBuffer(1, bufferSize, sampleRate);
    }

    const channelData = this.audioBuffer.getChannelData(0);
    const envelope = new Float32Array(bufferSize);

    const fadeInSamples = Math.floor(sampleRate * 0.2);
    const fadeOutSamples = Math.floor(sampleRate * 0.3);
    const sustainSamples = bufferSize - fadeInSamples - fadeOutSamples;

    for (let i = 0; i < fadeInSamples; i++) {
      envelope[i] = i / fadeInSamples;
    }
    for (let i = 0; i < sustainSamples; i++) {
      envelope[fadeInSamples + i] = 1;
    }
    for (let i = 0; i < fadeOutSamples; i++) {
      envelope[fadeInSamples + sustainSamples + i] = 1 - i / fadeOutSamples;
    }

    let phase = 0;
    let currentFreq = 600;

    for (let i = 0; i < bufferSize; i++) {
      if (i % 100 === 0) {
        currentFreq = 400 + Math.random() * 400;
      }

      phase += (2 * Math.PI * currentFreq) / sampleRate;
      if (phase > 2 * Math.PI) {
        phase -= 2 * Math.PI;
      }

      const noise = (Math.random() * 2 - 1) * 0.3;
      const tone = Math.sin(phase) * 0.1;
      const crackle = Math.random() > 0.995 ? (Math.random() - 0.5) * 0.5 : 0;

      channelData[i] = (noise + tone + crackle) * envelope[i] * 0.3;
    }

    const source = ctx.createBufferSource();
    source.buffer = this.audioBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.5;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.3;

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.start();
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gainNode.disconnect();
    };
  }

  private hexToRgb(hex: string): RGB {
    let h = hex.replace('#', '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    const num = parseInt(h, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
    };
  }

  private lerpColor(color1: string, color2: string, t: number): string {
    const c1 = this.hexToRgb(color1);
    const c2 = this.hexToRgb(color2);

    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);

    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  private parsePathD(d: string): Path2D {
    const path = new Path2D();
    const commands = d.match(/[a-zA-Z][^a-zA-Z]*/g) || [];

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const type = cmd[0];
      const args = cmd.slice(1).trim().split(/[\s,]+/).map(Number);

      switch (type) {
        case 'M':
          path.moveTo(args[0], args[1]);
          break;
        case 'm':
          path.moveTo(args[0], args[1]);
          break;
        case 'L':
          for (let j = 0; j < args.length; j += 2) {
            path.lineTo(args[j], args[j + 1]);
          }
          break;
        case 'l':
          for (let j = 0; j < args.length; j += 2) {
            path.lineTo(args[j], args[j + 1]);
          }
          break;
        case 'H':
          for (let j = 0; j < args.length; j++) {
            path.lineTo(args[j], 0);
          }
          break;
        case 'h':
          for (let j = 0; j < args.length; j++) {
            path.lineTo(args[j], 0);
          }
          break;
        case 'V':
          for (let j = 0; j < args.length; j++) {
            path.lineTo(0, args[j]);
          }
          break;
        case 'v':
          for (let j = 0; j < args.length; j++) {
            path.lineTo(0, args[j]);
          }
          break;
        case 'C':
          for (let j = 0; j < args.length; j += 6) {
            path.bezierCurveTo(args[j], args[j + 1], args[j + 2], args[j + 3], args[j + 4], args[j + 5]);
          }
          break;
        case 'c':
          for (let j = 0; j < args.length; j += 6) {
            path.bezierCurveTo(args[j], args[j + 1], args[j + 2], args[j + 3], args[j + 4], args[j + 5]);
          }
          break;
        case 'Q':
          for (let j = 0; j < args.length; j += 4) {
            path.quadraticCurveTo(args[j], args[j + 1], args[j + 2], args[j + 3]);
          }
          break;
        case 'q':
          for (let j = 0; j < args.length; j += 4) {
            path.quadraticCurveTo(args[j], args[j + 1], args[j + 2], args[j + 3]);
          }
          break;
        case 'Z':
        case 'z':
          path.closePath();
          break;
      }
    }

    return path;
  }

  public setTemporaryStroke(stroke: { points: { x: number; y: number }[]; color: string; radius: number } | null): void {
    this.temporaryStroke = stroke;
  }

  public setTemporaryLine(line: { start: { x: number; y: number }; end: { x: number; y: number }; color: string; radius: number } | null): void {
    this.temporaryLine = line;
  }

  public getSkeleton(): Skeleton | null {
    return this.skeleton;
  }

  public getSilkColor(): SilkColor | null {
    return this.silkColor;
  }

  public getStrokes(): BrushStroke[] {
    return this.strokes;
  }

  public getLines(): Line[] {
    return this.lines;
  }
}
