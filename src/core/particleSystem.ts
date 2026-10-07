import type { Particle } from '@/types';

const STEAM_EMIT_RATE = 30;
const MAX_PULP_PARTICLES = 200;
const WATER_DROP_FALL_SPEED = 100;
const WATER_DROP_RADIUS = 3;

export type ParticleType = 'steam' | 'pulp' | 'waterdrop';

export interface ParticleSystemStats {
  active: number;
  pooled: number;
  pulpCount: number;
}

/**
 * 无框架依赖的粒子内核：不持有任何 React 引用，
 * canvas 仅通过 attachCanvas 显式绑定，dispose 时统一释放，
 * 保证组件卸载后不再残留对渲染目标的引用。
 */
export class ParticleSystem {
  private particles: Particle[] = [];
  private pool: Particle[] = [];
  private particleTypeMap = new Map<number, ParticleType>();
  private nextId = 0;
  private steamEmitAccumulator = 0;
  private pulpCount = 0;
  private canvas: HTMLCanvasElement | null = null;
  private disposed = false;

  constructor(private readonly maxParticles: number) {}

  attachCanvas(canvas: HTMLCanvasElement): void {
    if (this.disposed) return;
    this.canvas = canvas;
  }

  detachCanvas(): void {
    this.canvas = null;
  }

  getAttachedCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private acquireParticle(): Particle | null {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    if (this.particles.length < this.maxParticles) {
      return {
        id: this.nextId++,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0,
        size: 0,
        color: '#ffffff',
      };
    }
    return null;
  }

  private releaseParticle(particle: Particle): void {
    this.pool.push(particle);
  }

  update(deltaTime: number): void {
    if (this.disposed) return;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;
      p.z += p.vz * deltaTime;
      p.life -= deltaTime;

      if (p.life <= 0) {
        if (this.particleTypeMap.get(p.id) === 'pulp') {
          this.pulpCount = Math.max(0, this.pulpCount - 1);
        }
        this.particleTypeMap.delete(p.id);
        this.releaseParticle(p);
        this.particles.splice(i, 1);
      }
    }
  }

  emitSteam(x: number, y: number, z: number): void {
    if (this.disposed) return;
    this.steamEmitAccumulator += STEAM_EMIT_RATE;
    while (this.steamEmitAccumulator >= 1) {
      this.steamEmitAccumulator -= 1;
      const p = this.acquireParticle();
      if (!p) break;

      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random() * 5;

      p.x = x + Math.cos(angle) * spread;
      p.y = y;
      p.z = z + Math.sin(angle) * spread;
      p.vx = Math.cos(angle) * 5;
      p.vy = -20 - Math.random() * 30;
      p.vz = Math.sin(angle) * 5;
      p.life = 1.5 + Math.random() * 1;
      p.maxLife = p.life;
      p.size = 3 + Math.random() * 4;
      p.color = `rgba(255, 255, 255, ${0.3 + Math.random() * 0.3})`;

      this.particleTypeMap.set(p.id, 'steam');
      this.particles.push(p);
    }
  }

  emitPulp(x: number, y: number, z: number, color: string): void {
    if (this.disposed) return;
    if (this.pulpCount >= MAX_PULP_PARTICLES) return;

    const p = this.acquireParticle();
    if (!p) return;

    const angle = Math.random() * Math.PI * 2;
    const speed = 20 + Math.random() * 40;

    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = Math.cos(angle) * speed;
    p.vy = -10 - Math.random() * 20;
    p.vz = Math.sin(angle) * speed;
    p.life = 2 + Math.random() * 2;
    p.maxLife = p.life;
    p.size = 2 + Math.random() * 3;
    p.color = color;

    this.pulpCount++;
    this.particleTypeMap.set(p.id, 'pulp');
    this.particles.push(p);
  }

  emitWaterDrop(x: number, y: number, z: number): void {
    if (this.disposed) return;
    const p = this.acquireParticle();
    if (!p) return;

    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = 0;
    p.vy = WATER_DROP_FALL_SPEED;
    p.vz = 0;
    p.life = 3;
    p.maxLife = 3;
    p.size = WATER_DROP_RADIUS * 2;
    p.color = 'rgba(100, 180, 255, 0.7)';

    this.particleTypeMap.set(p.id, 'waterdrop');
    this.particles.push(p);
  }

  getParticles(): Particle[] {
    return this.particles;
  }

  getStats(): ParticleSystemStats {
    return {
      active: this.particles.length,
      pooled: this.pool.length,
      pulpCount: this.pulpCount,
    };
  }

  /** 释放全部粒子、对象池与 canvas 引用，之后所有 emit/update 变为空操作。 */
  dispose(): void {
    this.particles.length = 0;
    this.pool.length = 0;
    this.particleTypeMap.clear();
    this.pulpCount = 0;
    this.steamEmitAccumulator = 0;
    this.canvas = null;
    this.disposed = true;
  }
}
