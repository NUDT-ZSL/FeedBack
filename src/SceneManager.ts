import type { Fish, Food, FishManager } from './FishManager';

export type DecorationType = 'coral' | 'shell' | 'wreck';

export interface Decoration {
  id: number;
  type: DecorationType;
  x: number;
  y: number;
  scale: number;
}

interface Bubble {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
}

interface Seaweed {
  x: number;
  height: number;
  phase: number;
  segments: number;
}

interface Sand {
  x: number;
  y: number;
  size: number;
  shade: number;
}

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

export class SceneManager {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private bubbles: Bubble[] = [];
  private seaweeds: Seaweed[] = [];
  private sands: Sand[] = [];
  public decorations: Decoration[] = [];
  private particles: Particle[] = [];
  private decorationIdCounter = 0;
  private time = 0;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.generateScene();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.generateScene();
  }

  private generateScene(): void {
    this.sands = [];
    const sandCount = Math.floor(this.width * 0.8);
    for (let i = 0; i < sandCount; i++) {
      this.sands.push({
        x: Math.random() * this.width,
        y: this.height - 10 - Math.random() * 30,
        size: 1 + Math.random() * 2,
        shade: 0.3 + Math.random() * 0.4
      });
    }

    this.seaweeds = [];
    const seaweedCount = Math.floor(this.width / 120);
    for (let i = 0; i < seaweedCount; i++) {
      this.seaweeds.push({
        x: 40 + Math.random() * (this.width - 80),
        height: 40 + Math.random() * 60,
        phase: Math.random() * Math.PI * 2,
        segments: 4 + Math.floor(Math.random() * 3)
      });
    }

    this.bubbles = [];
    for (let i = 0; i < 25; i++) {
      this.bubbles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: 2 + Math.random() * 5,
        speed: 15 + Math.random() * 25,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  addDecoration(type: DecorationType, x: number, y: number): void {
    this.decorations.push({
      id: this.decorationIdCounter++,
      type,
      x,
      y: Math.max(y, this.height - 100),
      scale: 0.8 + Math.random() * 0.4
    });
    this.spawnParticles(x, y, '#ff7043', 20);
  }

  spawnParticles(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 40 + Math.random() * 80;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.8,
        maxLife: 0.8,
        color,
        size: 2 + Math.random() * 3
      });
    }
  }

  private drawBackground(): void {
    const gradient = this.ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, '#0a0a2a');
    gradient.addColorStop(1, '#1a237e');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.fillStyle = 'rgba(255,255,255,0.02)';
    for (let i = 0; i < 30; i++) {
      const x = (this.time * 5 + i * 137) % (this.width + 100) - 50;
      const y = (i * 73) % this.height;
      this.ctx.fillRect(x, y, 2, 2);
    }
  }

  private drawSand(): void {
    const gradient = this.ctx.createLinearGradient(0, this.height - 50, 0, this.height);
    gradient.addColorStop(0, 'rgba(194, 178, 128, 0)');
    gradient.addColorStop(1, 'rgba(194, 178, 128, 0.4)');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, this.height - 50, this.width, 50);

    for (const s of this.sands) {
      const c = Math.floor(s.shade * 255);
      this.ctx.fillStyle = `rgb(${c},${c - 20},${c - 60})`;
      this.ctx.fillRect(Math.floor(s.x), Math.floor(s.y), s.size, s.size);
    }
  }

  private drawSeaweed(dt: number): void {
    for (const sw of this.seaweeds) {
      sw.phase += dt * (Math.PI * 2 / 3);
      const ampRad = (5 * Math.PI) / 180;
      const segHeight = sw.height / sw.segments;

      this.ctx.save();
      this.ctx.translate(sw.x, this.height - 20);

      for (let i = 0; i < sw.segments; i++) {
        const t = i / sw.segments;
        const sway = Math.sin(sw.phase + t * 2) * ampRad * t;
        this.ctx.rotate(sway);

        const w = 4 + (1 - t) * 4;
        const h = segHeight;
        const green = Math.floor(100 + t * 80);
        this.ctx.fillStyle = `rgb(${Math.floor(30 + t * 20)},${green},${Math.floor(60 + t * 30)})`;
        this.ctx.fillRect(-w / 2, -h, w, h);
        this.ctx.translate(0, -h);
      }

      this.ctx.restore();
    }
  }

  private drawBubbles(dt: number): void {
    for (const b of this.bubbles) {
      b.phase += dt * 2;
      b.y -= b.speed * dt;
      b.x += Math.sin(b.phase) * 8 * dt;

      if (b.y < -10) {
        b.y = this.height + 10;
        b.x = Math.random() * this.width;
      }

      const alpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(b.phase));
      this.ctx.strokeStyle = `rgba(200, 220, 255, ${alpha})`;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.3})`;
      this.ctx.beginPath();
      this.ctx.arc(b.x - b.size * 0.3, b.y - b.size * 0.3, b.size * 0.3, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawDecoration(d: Decoration): void {
    this.ctx.save();
    this.ctx.translate(d.x, d.y);
    this.ctx.scale(d.scale, d.scale);
    this.ctx.imageSmoothingEnabled = false;

    switch (d.type) {
      case 'coral':
        this.drawCoral();
        break;
      case 'shell':
        this.drawShell();
        break;
      case 'wreck':
        this.drawWreck();
        break;
    }

    this.ctx.restore();
  }

  private drawCoral(): void {
    const colors = ['#ff7043', '#ff8a65', '#ffab91', '#e64a19'];
    const branches = [
      { x: 0, y: 0, h: 40, w: 8 },
      { x: -15, y: 5, h: 30, w: 6 },
      { x: 15, y: 5, h: 35, w: 7 },
      { x: -8, y: -10, h: 20, w: 5 },
      { x: 10, y: -8, h: 25, w: 6 }
    ];
    for (const b of branches) {
      this.ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      for (let j = 0; j < b.h; j += 4) {
        const w = b.w * (1 - j / b.h * 0.5);
        this.ctx.fillRect(b.x - w / 2, -j - b.y, w, 4);
      }
      this.ctx.fillStyle = '#ffccbc';
      this.ctx.fillRect(branches[0].x - 2, -branches[0].h - branches[0].y, 4, 4);
    }
  }

  private drawShell(): void {
    this.ctx.fillStyle = '#ffe0b2';
    this.ctx.beginPath();
    this.ctx.ellipse(0, 0, 20, 14, 0, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#ffab91';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI - Math.PI / 2;
      const rx = 4 + i * 3;
      const ry = 3 + i * 2;
      this.ctx.beginPath();
      this.ctx.ellipse(Math.cos(a) * 5, Math.sin(a) * 3, rx, ry, a, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.fillStyle = '#fff8e1';
    this.ctx.beginPath();
    this.ctx.ellipse(-3, -2, 5, 4, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawWreck(): void {
    this.ctx.fillStyle = '#5d4037';
    this.ctx.fillRect(-30, -15, 60, 20);
    this.ctx.fillStyle = '#6d4c41';
    this.ctx.fillRect(-28, -20, 30, 8);
    this.ctx.fillStyle = '#4e342e';
    this.ctx.fillRect(-15, -25, 4, 12);
    this.ctx.fillStyle = '#3e2723';
    for (let i = 0; i < 4; i++) {
      this.ctx.fillRect(-25 + i * 15, -12, 6, 4);
    }
    this.ctx.fillStyle = '#8d6e63';
    this.ctx.fillRect(-30, 5, 8, 10);
    this.ctx.fillRect(20, 5, 10, 8);
    this.ctx.fillStyle = 'rgba(109, 76, 65, 0.6)';
    this.ctx.fillRect(-5, -2, 15, 3);
  }

  private drawDecorations(): void {
    for (const d of this.decorations) {
      this.drawDecoration(d);
    }
  }

  private drawFood(food: Food): void {
    this.ctx.fillStyle = '#ffab91';
    this.ctx.fillRect(food.x - 2, food.y - 2, 4, 4);
    this.ctx.fillStyle = '#ffccbc';
    this.ctx.fillRect(food.x - 1, food.y - 1, 2, 2);
  }

  private drawFish(fish: Fish, fishManager: FishManager): void {
    const { x, y, size, phase, color, vx, vy, isBlinking } = fish;
    const direction = vx >= 0 ? 1 : -1;
    const angle = Math.atan2(vy, vx);

    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(angle);
    this.ctx.scale(direction, 1);
    this.ctx.imageSmoothingEnabled = false;

    const s = size / 8;
    const wave = Math.sin(phase) * 0.2;
    const finWave = Math.sin(phase * 2) * 0.3;
    const tailWave = Math.sin(phase * 1.5) * 0.4;

    const bodyColor = fishManager.colorToCss(color.h, color.s, color.v);
    const darkColor = fishManager.colorToCss(color.h, Math.min(1, color.s + 0.15), Math.max(0.3, color.v - 0.3));
    const lightColor = fishManager.colorToCss(color.h, Math.max(0.3, color.s - 0.15), Math.min(1, color.v + 0.2));

    this.ctx.fillStyle = bodyColor;
    for (let py = -2; py <= 2; py++) {
      for (let px = -3; px <= 2; px++) {
        if (px === -3 && (py === -2 || py === 2)) continue;
        if (px === 2 && (py === -2 || py === 2)) continue;
        const wobble = (py / 2) * wave;
        this.ctx.fillRect((px + wobble) * s, py * s, s, s);
      }
    }

    this.ctx.fillStyle = lightColor;
    for (let px = -2; px <= 1; px++) {
      this.ctx.fillRect(px * s, s, s, s);
    }

    this.ctx.fillStyle = darkColor;
    for (let px = -2; px <= 1; px++) {
      this.ctx.fillRect(px * s, -2 * s, s, s);
    }

    this.ctx.fillStyle = bodyColor;
    this.ctx.save();
    this.ctx.translate(-3 * s, 0);
    this.ctx.rotate(tailWave);
    for (let py = -2; py <= 2; py++) {
      for (let px = 0; px <= 2; px++) {
        if (px === 2 && Math.abs(py) === 2) continue;
        this.ctx.fillRect(px * s, py * s, s, s);
      }
    }
    for (let py = -3; py <= 3; py++) {
      if (Math.abs(py) === 3) continue;
      this.ctx.fillRect(-1 * s, py * s * 0.8, s, s);
    }
    this.ctx.restore();

    this.ctx.fillStyle = darkColor;
    this.ctx.save();
    this.ctx.translate(0, -2 * s);
    this.ctx.rotate(-finWave);
    this.ctx.fillRect(-s, -s, 2 * s, s);
    this.ctx.fillRect(0, -2 * s, s, s);
    this.ctx.restore();

    this.ctx.fillStyle = darkColor;
    this.ctx.save();
    this.ctx.translate(-1 * s, 2 * s);
    this.ctx.rotate(finWave);
    this.ctx.fillRect(-s, 0, 2 * s, s);
    this.ctx.fillRect(0, s, s, s);
    this.ctx.restore();

    if (isBlinking) {
      this.ctx.fillStyle = darkColor;
      this.ctx.fillRect(1 * s, -1 * s, 2 * s, s);
    } else {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(1 * s, -s, 2 * s, 2 * s);
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(2 * s, -s, s, s);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(2 * s, -s, s * 0.5, s * 0.5);
    }

    if (fish.state === 'heartbeat') {
      this.ctx.fillStyle = '#ff1744';
      const hx = 4 * s;
      const hy = -3 * s;
      const pulse = 0.8 + 0.4 * Math.sin(fish.heartbeatTimer * Math.PI * 6);
      this.ctx.save();
      this.ctx.translate(hx, hy);
      this.ctx.scale(pulse, pulse);
      this.ctx.fillRect(-3, -2, 2, 2);
      this.ctx.fillRect(1, -2, 2, 2);
      this.ctx.fillRect(-4, -1, 8, 2);
      this.ctx.fillRect(-3, 1, 6, 1);
      this.ctx.fillRect(-2, 2, 4, 1);
      this.ctx.fillRect(-1, 3, 2, 1);
      this.ctx.restore();
    }

    this.ctx.restore();
  }

  private drawParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.vy += 20 * dt;

      const alpha = p.life / p.maxLife;
      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      this.ctx.globalAlpha = 1;
    }
  }

  render(dt: number, fishManager: FishManager): void {
    this.time += dt;

    this.drawBackground();
    this.drawSand();
    this.drawSeaweed(dt);
    this.drawDecorations();
    this.drawBubbles(dt);

    for (const f of fishManager.foods) {
      this.drawFood(f);
    }

    const sortedFish = [...fishManager.fishes].sort((a, b) => a.y - b.y);
    for (const fish of sortedFish) {
      this.drawFish(fish, fishManager);
    }

    this.drawParticles(dt);
  }

  takeScreenshot(): string {
    return this.ctx.canvas.toDataURL('image/png');
  }
}
