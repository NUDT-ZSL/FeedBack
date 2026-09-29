import type { Vector2D } from './asteroid';

const CANVAS_SIZE = 400;
const SHIP_SIZE = 15;
const ACCELERATION = 0.12;
const MAX_SPEED = 3.5;
const FRICTION = 0.97;
const LASER_SPEED = 7;
const TRAIL_LENGTH = 5;

export interface Laser {
  x: number;
  y: number;
  vx: number;
  vy: number;
  active: boolean;
}

export class Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  maxHealth: number;
  score: number;
  fuel: number;
  maxFuel: number;
  shieldCount: number;
  fuelEfficiency: number;
  trail: Vector2D[];
  laser: Laser | null;
  facingAngle: number;
  private keys: Set<string>;

  constructor() {
    this.x = CANVAS_SIZE / 2;
    this.y = CANVAS_SIZE / 2;
    this.vx = 0;
    this.vy = 0;
    this.health = 3;
    this.maxHealth = 3;
    this.score = 0;
    this.fuel = 100;
    this.maxFuel = 100;
    this.shieldCount = 0;
    this.fuelEfficiency = 1;
    this.trail = [];
    this.laser = null;
    this.facingAngle = -Math.PI / 2;
    this.keys = new Set();
  }

  setKey(code: string, pressed: boolean): void {
    if (pressed) {
      this.keys.add(code);
      if (code === 'Space') {
        this.fireLaser();
      }
    } else {
      this.keys.delete(code);
    }
  }

  private fireLaser(): void {
    if (this.laser?.active || this.fuel <= 0) return;
    const fuelCost = 10 / this.fuelEfficiency;
    if (this.fuel < fuelCost) return;
    this.fuel -= fuelCost;
    this.laser = {
      x: this.x,
      y: this.y,
      vx: Math.cos(this.facingAngle) * LASER_SPEED,
      vy: Math.sin(this.facingAngle) * LASER_SPEED,
      active: true
    };
  }

  upgradeShield(): boolean {
    if (this.score < 50) return false;
    this.score -= 50;
    this.shieldCount++;
    return true;
  }

  upgradeFuel(): boolean {
    if (this.score < 30) return false;
    this.score -= 30;
    this.fuelEfficiency *= 1.3;
    this.fuel = Math.min(this.maxFuel, this.fuel + 30);
    return true;
  }

  takeDamage(amount: number): boolean {
    if (this.shieldCount > 0) {
      this.shieldCount--;
      return false;
    }
    this.health -= amount;
    return true;
  }

  addScore(points: number): void {
    this.score += points;
  }

  update(): void {
    let ax = 0;
    let ay = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ay -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ay += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ax -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ax += 1;

    const mag = Math.sqrt(ax * ax + ay * ay);
    if (mag > 0) {
      ax /= mag;
      ay /= mag;
      this.facingAngle = Math.atan2(ay, ax);
      this.vx += ax * ACCELERATION;
      this.vy += ay * ACCELERATION;
    }

    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > MAX_SPEED) {
      this.vx = (this.vx / speed) * MAX_SPEED;
      this.vy = (this.vy / speed) * MAX_SPEED;
    }

    this.vx *= FRICTION;
    this.vy *= FRICTION;

    this.x += this.vx;
    this.y += this.vy;

    this.x = Math.max(SHIP_SIZE, Math.min(CANVAS_SIZE - SHIP_SIZE, this.x));
    this.y = Math.max(SHIP_SIZE, Math.min(CANVAS_SIZE - SHIP_SIZE, this.y));

    this.trail.unshift({ x: this.x, y: this.y });
    if (this.trail.length > TRAIL_LENGTH) {
      this.trail.pop();
    }

    if (this.laser?.active) {
      this.laser.x += this.laser.vx;
      this.laser.y += this.laser.vy;
      if (
        this.laser.x < 0 ||
        this.laser.x > CANVAS_SIZE ||
        this.laser.y < 0 ||
        this.laser.y > CANVAS_SIZE
      ) {
        this.laser.active = false;
      }
    }

    if (this.fuel < this.maxFuel) {
      this.fuel = Math.min(this.maxFuel, this.fuel + 0.08 * this.fuelEfficiency);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const t = this.trail[i];
      const alpha = (1 - i / TRAIL_LENGTH) * 0.4;
      const size = SHIP_SIZE * (1 - i / TRAIL_LENGTH) * 0.7;
      ctx.beginPath();
      ctx.arc(t.x, t.y, size * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(102, 252, 241, ${alpha})`;
      ctx.fill();
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.facingAngle);

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const px = Math.cos(angle) * SHIP_SIZE;
      const py = Math.sin(angle) * SHIP_SIZE;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#66FCF1';
    ctx.fill();
    ctx.strokeStyle = '#45A29E';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(SHIP_SIZE, 0);
    ctx.lineTo(SHIP_SIZE * 0.4, -SHIP_SIZE * 0.3);
    ctx.lineTo(SHIP_SIZE * 0.4, SHIP_SIZE * 0.3);
    ctx.closePath();
    ctx.fillStyle = '#0B0C10';
    ctx.fill();

    ctx.restore();

    if (this.shieldCount > 0) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, SHIP_SIZE + 6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(102, 252, 241, 0.5)`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.laser?.active) {
      ctx.beginPath();
      ctx.moveTo(this.laser.x, this.laser.y);
      ctx.lineTo(
        this.laser.x - this.laser.vx * 2,
        this.laser.y - this.laser.vy * 2
      );
      ctx.strokeStyle = '#00B4D8';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(this.laser.x, this.laser.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#90E0EF';
      ctx.fill();
    }
  }
}
