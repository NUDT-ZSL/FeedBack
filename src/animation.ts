export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  type: 'flower' | 'confetti' | 'sparkle' | 'tear';
}

export interface Animation {
  id: number;
  startTime: number;
  duration: number;
  type: 'bounce-in' | 'pulse' | 'shake' | 'upgrade-ring' | 'eat' | 'sleep-breath';
  data: any;
  finished: boolean;
}

export class AnimationManager {
  private particles: Particle[] = [];
  private animations: Animation[] = [];
  private nextId = 0;

  update(dt: number, now: number): void {
    this.particles = this.particles.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'flower' || p.type === 'confetti') {
        p.vy += 120 * dt;
        p.vx += (Math.random() - 0.5) * 30 * dt;
      } else if (p.type === 'tear') {
        p.vy += 200 * dt;
      } else if (p.type === 'sparkle') {
        p.vy -= 60 * dt;
      }
      p.life -= dt;
      return p.life > 0;
    });

    this.animations = this.animations.filter(a => {
      if (now - a.startTime >= a.duration) {
        a.finished = true;
        return false;
      }
      return true;
    });
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.type === 'flower') {
        this.drawPixelFlower(ctx, p.x, p.y, p.size, p.color);
      } else if (p.type === 'sparkle') {
        this.drawSparkle(ctx, p.x, p.y, p.size, p.color);
      } else {
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
      }
      ctx.restore();
    }
  }

  private drawPixelFlower(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
    const s = Math.max(1, Math.floor(size));
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x - s), Math.floor(y), s, s);
    ctx.fillRect(Math.floor(x + s), Math.floor(y), s, s);
    ctx.fillRect(Math.floor(x), Math.floor(y - s), s, s);
    ctx.fillRect(Math.floor(x), Math.floor(y + s), s, s);
    ctx.fillStyle = '#FFE082';
    ctx.fillRect(Math.floor(x), Math.floor(y), s, s);
  }

  private drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
    const s = Math.max(1, Math.floor(size));
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x), Math.floor(y - s * 2), s, s);
    ctx.fillRect(Math.floor(x), Math.floor(y + s * 2), s, s);
    ctx.fillRect(Math.floor(x - s * 2), Math.floor(y), s, s);
    ctx.fillRect(Math.floor(x + s * 2), Math.floor(y), s, s);
    ctx.fillRect(Math.floor(x - s), Math.floor(y - s), s, s);
    ctx.fillRect(Math.floor(x + s), Math.floor(y - s), s, s);
    ctx.fillRect(Math.floor(x - s), Math.floor(y + s), s, s);
    ctx.fillRect(Math.floor(x + s), Math.floor(y + s), s, s);
  }

  spawnFlowerBurst(x: number, y: number, count: number = 30): void {
    const colors = ['#FF6B9D', '#FFE66D', '#4ECDC4', '#A8E6CF', '#FF8B94', '#C9B1FF', '#81D4FA'];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = 80 + Math.random() * 120;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 100,
        life: 0.8,
        maxLife: 0.8,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 3 + Math.floor(Math.random() * 2),
        type: 'flower'
      });
    }
  }

  spawnUpgradeConfetti(x: number, y: number): void {
    const colors = ['#F5A623', '#4A90D9', '#FF6B9D', '#4ECDC4', '#FFE66D'];
    for (let i = 0; i < 50; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 150 + Math.random() * 200;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 150,
        life: 1.0 + Math.random() * 0.5,
        maxLife: 1.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 3 + Math.floor(Math.random() * 3),
        type: 'confetti'
      });
    }
  }

  spawnTears(x: number, y: number): void {
    for (let i = 0; i < 2; i++) {
      this.particles.push({
        x: x + (i === 0 ? -8 : 8),
        y: y,
        vx: (Math.random() - 0.5) * 10,
        vy: 20,
        life: 0.8,
        maxLife: 0.8,
        color: '#81D4FA',
        size: 2,
        type: 'tear'
      });
    }
  }

  spawnSparkles(x: number, y: number): void {
    const colors = ['#FFE082', '#FFF59D', '#FFEE58'];
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 20 + Math.random() * 30;
      this.particles.push({
        x: x + Math.cos(angle) * radius,
        y: y + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        life: 0.5,
        maxLife: 0.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 2,
        type: 'sparkle'
      });
    }
  }

  addAnimation(type: Animation['type'], duration: number, data: any = {}): number {
    const id = this.nextId++;
    this.animations.push({
      id,
      startTime: performance.now(),
      duration,
      type,
      data,
      finished: false
    });
    return id;
  }

  getAnimationProgress(id: number, now: number): number {
    const anim = this.animations.find(a => a.id === id);
    if (!anim) return 1;
    return Math.min(1, (now - anim.startTime) / anim.duration);
  }

  isAnimationFinished(id: number): boolean {
    const anim = this.animations.find(a => a.id === id);
    return !anim || anim.finished;
  }

  getEasingOut(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  getBounceOut(t: number): number {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  }

  clear(): void {
    this.particles = [];
    this.animations = [];
  }
}
