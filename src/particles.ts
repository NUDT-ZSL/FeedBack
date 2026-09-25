import { Vector2 } from './ball';

interface Particle {
  position: Vector2;
  velocity: Vector2;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  active: boolean;
}

export class ParticleSystem {
  private particles: Particle[];
  private poolSize: number;
  private gravity: number;

  constructor(poolSize: number = 200) {
    this.poolSize = poolSize;
    this.particles = [];
    this.gravity = 0.15;
    this.initializePool();
  }

  private initializePool(): void {
    for (let i = 0; i < this.poolSize; i++) {
      this.particles.push({
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        life: 0,
        maxLife: 1,
        color: '#FFD700',
        size: 3,
        active: false
      });
    }
  }

  emit(
    position: Vector2,
    count: number,
    color: string,
    minSpeed: number,
    maxSpeed: number,
    minLife: number,
    maxLife: number,
    minSize: number,
    maxSize: number,
    angleSpread: number = Math.PI * 2,
    angleStart: number = -Math.PI / 2
  ): void {
    let emitted = 0;
    for (let i = 0; i < this.particles.length && emitted < count; i++) {
      if (!this.particles[i].active) {
        const angle = angleStart + (Math.random() - 0.5) * angleSpread;
        const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);

        this.particles[i].position = { ...position };
        this.particles[i].velocity = {
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed
        };
        const life = minLife + Math.random() * (maxLife - minLife);
        this.particles[i].life = life;
        this.particles[i].maxLife = life;
        this.particles[i].color = color;
        this.particles[i].size = minSize + Math.random() * (maxSize - minSize);
        this.particles[i].active = true;
        emitted++;
      }
    }
  }

  emitHoleEffect(position: Vector2): void {
    this.emit(position, 50, '#FFD700', 2, 6, 1, 2, 2, 5, Math.PI, -Math.PI / 2);
    this.emit(position, 30, '#FFA500', 1, 4, 0.8, 1.5, 1.5, 3, Math.PI, -Math.PI / 2);
  }

  emitFailEffect(position: Vector2): void {
    this.emit(position, 30, '#FF4444', 1, 3, 0.5, 1, 2, 4, Math.PI * 2, 0);
  }

  update(deltaTime: number): void {
    for (const particle of this.particles) {
      if (!particle.active) continue;

      particle.life -= deltaTime;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }

      particle.velocity.y += this.gravity;
      particle.position.x += particle.velocity.x * deltaTime * 60;
      particle.position.y += particle.velocity.y * deltaTime * 60;
    }
  }

  render(ctx: CanvasRenderingContext2D, tiltAngle: number): void {
    for (const particle of this.particles) {
      if (!particle.active) continue;

      const alpha = particle.life / particle.maxLife;
      const size = particle.size * alpha;

      ctx.save();
      ctx.translate(particle.position.x, particle.position.y);
      ctx.scale(1, Math.cos(tiltAngle));
      ctx.globalAlpha = alpha;

      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
      gradient.addColorStop(0, particle.color);
      gradient.addColorStop(1, 'transparent');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  clear(): void {
    for (const particle of this.particles) {
      particle.active = false;
    }
  }
}
