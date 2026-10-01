export type ParticleType =
  | 'splash'
  | 'fusionAura'
  | 'fireSpirit'
  | 'iceCrystal'
  | 'stone'
  | 'steam'
  | 'sandstorm'
  | 'blackhole';

export interface ParticleConfig {
  type: ParticleType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
  gravity?: number;
  rotationSpeed?: number;
}

export class Particle {
  id: string;
  type: ParticleType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  baseSize: number;
  color: string;
  opacity: number;
  gravity: number;
  rotation: number;
  rotationSpeed: number;

  constructor(config: ParticleConfig) {
    this.id = Math.random().toString(36).slice(2);
    this.type = config.type;
    this.x = config.x;
    this.y = config.y;
    this.vx = config.vx;
    this.vy = config.vy;
    this.life = config.life;
    this.maxLife = config.life;
    this.size = config.size;
    this.baseSize = config.size;
    this.color = config.color;
    this.opacity = 1;
    this.gravity = config.gravity ?? 0;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = config.rotationSpeed ?? 0;
  }

  update(deltaTime: number): boolean {
    const dt = deltaTime / 16.67;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += this.gravity * dt;
    this.rotation += this.rotationSpeed * dt;
    this.life -= deltaTime;

    const lifeRatio = this.life / this.maxLife;
    this.opacity = Math.max(0, lifeRatio);
    this.size = this.baseSize * (0.3 + 0.7 * lifeRatio);

    return this.life > 0;
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    switch (this.type) {
      case 'splash':
        this.renderSplash(ctx);
        break;
      case 'fusionAura':
        this.renderFusionAura(ctx);
        break;
      case 'fireSpirit':
        this.renderFireSpirit(ctx);
        break;
      case 'iceCrystal':
        this.renderIceCrystal(ctx);
        break;
      case 'stone':
        this.renderStone(ctx);
        break;
      case 'steam':
        this.renderSteam(ctx);
        break;
      case 'sandstorm':
        this.renderSandstorm(ctx);
        break;
      case 'blackhole':
        this.renderBlackhole(ctx);
        break;
    }

    ctx.restore();
  }

  private renderSplash(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size);
    gradient.addColorStop(0, this.color);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, this.size, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderFusionAura(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, this.size, 0, Math.PI * 2);
    ctx.stroke();
  }

  private renderFireSpirit(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size);
    gradient.addColorStop(0, '#fff5cc');
    gradient.addColorStop(0.4, '#ff9933');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? this.size : this.size * 0.5;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  private renderIceCrystal(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const endX = Math.cos(angle) * this.size;
      const endY = Math.sin(angle) * this.size;
      ctx.lineTo(endX, endY);
      ctx.stroke();
      for (let j = 1; j <= 2; j++) {
        const branchRatio = j / 3;
        const bx = Math.cos(angle) * this.size * branchRatio;
        const by = Math.sin(angle) * this.size * branchRatio;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(
          bx + Math.cos(angle + Math.PI / 4) * this.size * 0.2,
          by + Math.sin(angle + Math.PI / 4) * this.size * 0.2
        );
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(
          bx + Math.cos(angle - Math.PI / 4) * this.size * 0.2,
          by + Math.sin(angle - Math.PI / 4) * this.size * 0.2
        );
        ctx.stroke();
      }
    }
  }

  private renderStone(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    const points = 7;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const r = this.size * (0.7 + Math.sin(i * 1.5) * 0.3);
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3d2817';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private renderSteam(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, this.size, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderSandstorm(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = this.color;
    for (let i = 0; i < 3; i++) {
      const offsetAngle = (i / 3) * Math.PI * 2 + this.rotation;
      const ox = Math.cos(offsetAngle) * this.size * 0.3;
      const oy = Math.sin(offsetAngle) * this.size * 0.3;
      ctx.beginPath();
      ctx.arc(ox, oy, this.size * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderBlackhole(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size);
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(0.5, this.color);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, this.size * (0.4 + i * 0.2), 0, Math.PI * 1.5);
      ctx.stroke();
    }
  }
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private readonly MAX_PARTICLES = 500;
  private readonly MERGE_THRESHOLD = 500;

  addParticle(config: ParticleConfig): void {
    if (this.particles.length >= this.MAX_PARTICLES) {
      this.mergeSimilarParticles();
    }
    this.particles.push(new Particle(config));
  }

  addParticles(configs: ParticleConfig[]): void {
    for (const config of configs) {
      this.addParticle(config);
    }
  }

  createSplash(x: number, y: number, color: string): void {
    const count = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      this.addParticle({
        type: 'splash',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 500,
        size: 6 + Math.random() * 4,
        color,
        gravity: 0.05
      });
    }
  }

  createFusionAura(x: number, y: number, color: string): void {
    const duration = 1500;
    const maxRadius = 120;
    const steps = 30;
    for (let i = 0; i < steps; i++) {
      const progress = i / steps;
      setTimeout(() => {
        const radius = progress < 0.5
          ? maxRadius * (progress * 2)
          : maxRadius * (1 - (progress - 0.5) * 2);
        this.addParticle({
          type: 'fusionAura',
          x,
          y,
          vx: 0,
          vy: 0,
          life: 100,
          size: radius,
          color
        });
      }, (duration / steps) * i);
    }
  }

  createFireSpirit(x: number, y: number): void {
    const duration = 3000;
    const emitInterval = 50;
    let elapsed = 0;
    const emit = () => {
      if (elapsed >= duration) return;
      for (let i = 0; i < 3; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
        const speed = 1 + Math.random() * 2;
        this.addParticle({
          type: 'fireSpirit',
          x: x + (Math.random() - 0.5) * 30,
          y: y + (Math.random() - 0.5) * 20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 800,
          size: 12 + Math.random() * 8,
          color: '#ff6600',
          gravity: -0.02
        });
      }
      elapsed += emitInterval;
      setTimeout(emit, emitInterval);
    };
    emit();
  }

  createIceCrystal(x: number, y: number): void {
    const duration = 3000;
    const emitInterval = 100;
    let elapsed = 0;
    const emit = () => {
      if (elapsed >= duration) return;
      for (let i = 0; i < 2; i++) {
        this.addParticle({
          type: 'iceCrystal',
          x: x + (Math.random() - 0.5) * 60,
          y: y + (Math.random() - 0.5) * 60,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -0.5 + Math.random() * 0.5,
          life: 1200,
          size: 15 + Math.random() * 10,
          color: '#88ddff',
          rotationSpeed: (Math.random() - 0.5) * 0.05
        });
      }
      elapsed += emitInterval;
      setTimeout(emit, emitInterval);
    };
    emit();
  }

  createStone(x: number, y: number): void {
    const duration = 3000;
    const emitInterval = 150;
    let elapsed = 0;
    const emit = () => {
      if (elapsed >= duration) return;
      for (let i = 0; i < 2; i++) {
        const angle = Math.PI / 2 + (Math.random() - 0.5) * 1;
        const speed = 1 + Math.random() * 2;
        this.addParticle({
          type: 'stone',
          x: x + (Math.random() - 0.5) * 40,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          life: 1000,
          size: 8 + Math.random() * 8,
          color: '#8b5a2b',
          gravity: 0.15
        });
      }
      elapsed += emitInterval;
      setTimeout(emit, emitInterval);
    };
    emit();
  }

  createSteam(x: number, y: number): void {
    const duration = 2000;
    const emitInterval = 60;
    let elapsed = 0;
    const emit = () => {
      if (elapsed >= duration) return;
      for (let i = 0; i < 3; i++) {
        this.addParticle({
          type: 'steam',
          x: x + (Math.random() - 0.5) * 50,
          y,
          vx: (Math.random() - 0.5) * 0.8,
          vy: -1 - Math.random() * 1.5,
          life: 1500,
          size: 20 + Math.random() * 15,
          color: '#ffffff',
          gravity: -0.01
        });
      }
      elapsed += emitInterval;
      setTimeout(emit, emitInterval);
    };
    emit();
  }

  createSandstorm(x: number, y: number): void {
    const duration = 2500;
    const emitInterval = 40;
    let elapsed = 0;
    const emit = () => {
      if (elapsed >= duration) return;
      for (let i = 0; i < 4; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 20 + Math.random() * 30;
        this.addParticle({
          type: 'sandstorm',
          x: x + Math.cos(angle) * dist,
          y: y + Math.sin(angle) * dist,
          vx: Math.cos(angle + Math.PI / 2) * 2,
          vy: Math.sin(angle + Math.PI / 2) * 2 - 0.5,
          life: 800,
          size: 8 + Math.random() * 6,
          color: '#d4a54a',
          rotationSpeed: 0.2
        });
      }
      elapsed += emitInterval;
      setTimeout(emit, emitInterval);
    };
    emit();
  }

  createBlackhole(x: number, y: number, balls: { x: number; y: number }[]): void {
    const duration = 2500;
    const emitInterval = 50;
    let elapsed = 0;
    const emit = () => {
      if (elapsed >= duration) return;
      for (let i = 0; i < 5; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 80;
        this.addParticle({
          type: 'blackhole',
          x: x + Math.cos(angle) * dist,
          y: y + Math.sin(angle) * dist,
          vx: -Math.cos(angle) * 3,
          vy: -Math.sin(angle) * 3,
          life: 1000,
          size: 10 + Math.random() * 10,
          color: '#9932cc',
          rotationSpeed: 0.3
        });
      }
      for (const ball of balls) {
        const dx = x - ball.x;
        const dy = y - ball.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) {
          ball.x += (dx / dist) * 4;
          ball.y += (dy / dist) * 4;
        }
      }
      elapsed += emitInterval;
      setTimeout(emit, emitInterval);
    };
    emit();
  }

  private mergeSimilarParticles(): void {
    const grouped = new Map<string, Particle[]>();
    for (const p of this.particles) {
      const key = `${p.type}_${Math.floor(p.x / 20)}_${Math.floor(p.y / 20)}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }

    const merged: Particle[] = [];
    for (const group of grouped.values()) {
      if (group.length <= 2) {
        merged.push(...group);
      } else {
        const avgX = group.reduce((s, p) => s + p.x, 0) / group.length;
        const avgY = group.reduce((s, p) => s + p.y, 0) / group.length;
        const avgSize = group.reduce((s, p) => s + p.baseSize, 0) / group.length;
        const avgLife = group.reduce((s, p) => s + p.life, 0) / group.length;
        merged.push(new Particle({
          type: group[0].type,
          x: avgX,
          y: avgY,
          vx: 0,
          vy: 0,
          life: avgLife,
          size: avgSize * Math.min(group.length, 3),
          color: group[0].color
        }));
      }
    }
    this.particles = merged;
  }

  update(deltaTime: number): void {
    this.particles = this.particles.filter(p => p.update(deltaTime));
    if (this.particles.length > this.MERGE_THRESHOLD) {
      this.mergeSimilarParticles();
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      particle.render(ctx);
    }
  }

  getCount(): number {
    return this.particles.length;
  }
}
