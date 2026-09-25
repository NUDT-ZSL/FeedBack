import { RandomSource } from './rng.js';

export interface Brick {
  x: number;
  y: number;
  radius: number;
  color: string;
  alive: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

const BRICK_COLORS = [
  '#ff4757',
  '#ffa502',
  '#ffd32a',
  '#2ed573',
  '#1e90ff',
  '#a55eea'
];

export const BRICK_RADIUS = 10;
export const BRICK_SPACING = 2;
export const PARTICLE_MAX_COUNT = 200;
const BRICK_DIAMETER = BRICK_RADIUS * 2;
const BRICK_STEP_X = BRICK_DIAMETER + BRICK_SPACING;
const BRICK_STEP_Y = BRICK_DIAMETER + BRICK_SPACING;
const HONEYCOMB_TOLERANCE = 2;

export function areBricksAdjacent(
  first: Pick<Brick, 'x' | 'y'>,
  second: Pick<Brick, 'x' | 'y'>
): boolean {
  const dx = Math.abs(second.x - first.x);
  const dy = Math.abs(second.y - first.y);

  return (
    (Math.abs(dx - BRICK_STEP_X) < HONEYCOMB_TOLERANCE &&
      dy < HONEYCOMB_TOLERANCE) ||
    (Math.abs(dx - BRICK_STEP_X / 2) < HONEYCOMB_TOLERANCE &&
      Math.abs(dy - BRICK_STEP_Y) < HONEYCOMB_TOLERANCE)
  );
}

export class BrickManager {
  private bricks: Brick[] = [];
  private particles: Particle[] = [];
  private totalBricks: number = 0;
  private canvasWidth: number;
  private canvasHeight: number;

  constructor(
    canvasWidth: number,
    canvasHeight: number,
    private random: RandomSource = Math.random
  ) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
  }

  generateHoneycombLayout(): void {
    this.bricks = [];
    const startX = BRICK_STEP_X;
    const startY = 60;
    const maxColumns = Math.floor((this.canvasWidth - 2 * BRICK_STEP_X) / BRICK_STEP_X);
    let row = 0;
    let total = 0;

    while (total < 80) {
      const offsetX = row % 2 === 1 ? BRICK_STEP_X / 2 : 0;
      const columnsInRow = row % 2 === 1 ? maxColumns - 1 : maxColumns;
      const y = startY + row * BRICK_STEP_Y;

      if (y + BRICK_RADIUS >= this.canvasHeight * 0.55) break;

      for (let col = 0; col < columnsInRow; col++) {
        const x = startX + offsetX + col * BRICK_STEP_X;

        this.bricks.push({
          x,
          y,
          radius: BRICK_RADIUS,
          color: BRICK_COLORS[Math.floor(this.random() * BRICK_COLORS.length)],
          alive: true
        });
        total++;
        if (total >= 80) break;
      }
      row++;
    }

    this.totalBricks = this.bricks.length;
  }

  resize(canvasWidth: number, canvasHeight: number): void {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
  }

  checkCollision(ballX: number, ballY: number, ballRadius: number): {
    hit: boolean;
    particles: Particle[];
    comboChain: number;
  } {
    let hit = false;
    let comboChain = 0;
    const newParticles: Particle[] = [];

    for (const brick of this.bricks) {
      if (!brick.alive) continue;

      const dx = ballX - brick.x;
      const dy = ballY - brick.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < ballRadius + brick.radius) {
        brick.alive = false;
        hit = true;
        comboChain++;

        const particles = this.createParticles(brick.x, brick.y, brick.color);
        newParticles.push(...particles);

        const adjacentBricks = this.findAdjacentBricks(brick);
        for (const adj of adjacentBricks) {
          if (adj.alive && this.random() < 0.3) {
            adj.alive = false;
            comboChain++;
            const adjParticles = this.createParticles(adj.x, adj.y, adj.color);
            newParticles.push(...adjParticles);
          }
        }
        break;
      }
    }

    this.addParticles(newParticles);

    return {
      hit,
      particles: newParticles,
      comboChain
    };
  }

  private findAdjacentBricks(brick: Brick): Brick[] {
    const adjacent: Brick[] = [];
    for (const b of this.bricks) {
      if (b === brick || !b.alive) continue;

      if (areBricksAdjacent(brick, b)) {
        adjacent.push(b);
      }
    }

    return adjacent;
  }

  private createParticles(x: number, y: number, color: string): Particle[] {
    const count = 5 + Math.floor(this.random() * 4);
    const particles: Particle[] = [];

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + this.random() * 0.5;
      const speed = 1 + this.random() * 2;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        alpha: 1,
        life: 500,
        maxLife: 500
      });
    }

    return particles;
  }

  addParticles(newParticles: Particle[]): void {
    this.particles.push(...newParticles);
    if (this.particles.length > PARTICLE_MAX_COUNT) {
      this.particles = this.particles.slice(-PARTICLE_MAX_COUNT);
    }
  }

  updateParticles(deltaTime: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= deltaTime;
      p.alpha = Math.max(0, p.life / p.maxLife);

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  getBricks(): Brick[] {
    return this.bricks;
  }

  getParticles(): Particle[] {
    return this.particles;
  }

  getProgress(): number {
    if (this.totalBricks === 0) return 0;
    const aliveCount = this.bricks.filter((b) => b.alive).length;
    return 1 - aliveCount / this.totalBricks;
  }

  drawBricks(ctx: CanvasRenderingContext2D): void {
    for (const brick of this.bricks) {
      if (!brick.alive) continue;

      ctx.save();
      ctx.beginPath();
      ctx.arc(brick.x, brick.y, brick.radius, 0, Math.PI * 2);

      const gradient = ctx.createRadialGradient(
        brick.x - 3,
        brick.y - 3,
        0,
        brick.x,
        brick.y,
        brick.radius
      );
      gradient.addColorStop(0, this.lightenColor(brick.color, 30));
      gradient.addColorStop(0.7, brick.color);
      gradient.addColorStop(1, this.darkenColor(brick.color, 20));

      ctx.fillStyle = gradient;
      ctx.shadowColor = brick.color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }
  }

  drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2 + p.alpha * 2, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.restore();
    }
  }

  private lightenColor(color: string, percent: number): string {
    const num = parseInt(color.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00ff) + amt);
    const B = Math.min(255, (num & 0x0000ff) + amt);
    return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
  }

  private darkenColor(color: string, percent: number): string {
    const num = parseInt(color.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, (num >> 16) - amt);
    const G = Math.max(0, ((num >> 8) & 0x00ff) - amt);
    const B = Math.max(0, (num & 0x0000ff) - amt);
    return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
  }

  clear(): void {
    this.bricks = [];
    this.particles = [];
    this.totalBricks = 0;
  }
}
