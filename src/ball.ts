import type { Rng } from './rng.ts';

export interface Vector2 {
  x: number;
  y: number;
}

export interface Fence {
  start: Vector2;
  end: Vector2;
  normal: Vector2;
}

export type TerrainType = 'grass' | 'sand' | 'uphill' | 'downhill';

export interface TerrainZone {
  type: TerrainType;
  center: Vector2;
  radius: number;
  slopeAngle?: number;
  slopeDirection?: Vector2;
}

export const PHYSICS = {
  FIXED_STEP: 1 / 120,
  GRASS_FRICTION: 0.985,
  SAND_FRICTION: 0.92,
  UPHILL_FRICTION: 0.97,
  DOWNHILL_FRICTION: 0.99,
  UPHILL_SLOPE_FORCE: 0.15,
  DOWNHILL_SLOPE_FORCE: 0.2,
  UPHILL_DEVIATION: 0.3,
  DOWNHILL_DEVIATION: 0.5,
  RESTITUTION: 0.7,
  STOP_SPEED: 0.1,
  CAPTURE_SPEED: 8,
  HOLE_INNER_RATIO: 0.5,
  MAX_BOUNCES_PER_CHUNK: 4,
} as const;

const TERRAIN_PRIORITY: Record<TerrainType, number> = {
  sand: 0,
  uphill: 1,
  downhill: 2,
  grass: 3,
};

export function selectTerrain(zones: TerrainZone[], position: Vector2): TerrainZone {
  let best: TerrainZone | null = null;
  let bestDist = Infinity;
  for (const zone of zones) {
    const dx = position.x - zone.center.x;
    const dy = position.y - zone.center.y;
    const distSq = dx * dx + dy * dy;
    if (distSq >= zone.radius * zone.radius) continue;
    if (
      !best ||
      TERRAIN_PRIORITY[zone.type] < TERRAIN_PRIORITY[best.type] ||
      (TERRAIN_PRIORITY[zone.type] === TERRAIN_PRIORITY[best.type] && distSq < bestDist)
    ) {
      best = zone;
      bestDist = distSq;
    }
  }
  return best ?? { type: 'grass', center: { x: 0, y: 0 }, radius: 0 };
}

function closestPointOnSegment(p: Vector2, a: Vector2, b: Vector2): Vector2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function distance(p: Vector2, q: Vector2): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export function distanceToFence(fence: Fence, p: Vector2): number {
  return distance(closestPointOnSegment(p, fence.start, fence.end), p);
}

export class Ball {
  position: Vector2;
  velocity: Vector2;
  radius: number;
  isMoving: boolean;
  isInHole: boolean;
  holeScale: number;

  constructor(x: number, y: number) {
    this.position = { x, y };
    this.velocity = { x: 0, y: 0 };
    this.radius = 10;
    this.isMoving = false;
    this.isInHole = false;
    this.holeScale = 1;
  }

  reset(x: number, y: number): void {
    this.position = { x, y };
    this.velocity = { x: 0, y: 0 };
    this.isMoving = false;
    this.isInHole = false;
    this.holeScale = 1;
  }

  applyForce(direction: Vector2, power: number): void {
    const length = Math.hypot(direction.x, direction.y);
    if (length > 0) {
      this.velocity.x = (direction.x / length) * power;
      this.velocity.y = (direction.y / length) * power;
      this.isMoving = true;
    }
  }

  updateVisual(deltaTime: number): void {
    if (this.isInHole) {
      this.holeScale = Math.max(0, this.holeScale - deltaTime * 2);
    }
  }

  stepFixed(
    terrainZones: TerrainZone[],
    fences: Fence[],
    holePosition: Vector2,
    holeRadius: number,
    rng: Rng
  ): void {
    if (this.isInHole || !this.isMoving) return;

    const terrain = selectTerrain(terrainZones, this.position);
    let friction: number = PHYSICS.GRASS_FRICTION;
    let slopeForce: Vector2 = { x: 0, y: 0 };
    let directionDeviation = 0;

    switch (terrain.type) {
      case 'sand':
        friction = PHYSICS.SAND_FRICTION;
        break;
      case 'uphill':
        friction = PHYSICS.UPHILL_FRICTION;
        if (terrain.slopeDirection && terrain.slopeAngle) {
          const mag = Math.sin(terrain.slopeAngle) * PHYSICS.UPHILL_SLOPE_FORCE;
          slopeForce.x = -terrain.slopeDirection.x * mag;
          slopeForce.y = -terrain.slopeDirection.y * mag;
          directionDeviation = terrain.slopeAngle * PHYSICS.UPHILL_DEVIATION;
        }
        break;
      case 'downhill':
        friction = PHYSICS.DOWNHILL_FRICTION;
        if (terrain.slopeDirection && terrain.slopeAngle) {
          const mag = Math.sin(terrain.slopeAngle) * PHYSICS.DOWNHILL_SLOPE_FORCE;
          slopeForce.x = terrain.slopeDirection.x * mag;
          slopeForce.y = terrain.slopeDirection.y * mag;
          directionDeviation = terrain.slopeAngle * PHYSICS.DOWNHILL_DEVIATION;
        }
        break;
    }

    if (directionDeviation > 0) {
      const deviationAngle = (rng() - 0.5) * directionDeviation;
      const cos = Math.cos(deviationAngle);
      const sin = Math.sin(deviationAngle);
      const vx = this.velocity.x * cos - this.velocity.y * sin;
      const vy = this.velocity.x * sin + this.velocity.y * cos;
      this.velocity.x = vx;
      this.velocity.y = vy;
    }

    this.velocity.x += slopeForce.x;
    this.velocity.y += slopeForce.y;

    if (this.moveWithCollisions(fences, holePosition, holeRadius)) return;

    this.velocity.x *= friction;
    this.velocity.y *= friction;

    const onSlope = slopeForce.x !== 0 || slopeForce.y !== 0;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed < PHYSICS.STOP_SPEED && !onSlope) {
      this.velocity.x = 0;
      this.velocity.y = 0;
      this.isMoving = false;
      if (distance(this.position, holePosition) < holeRadius) {
        this.capture(holePosition);
      }
    }
  }

  private capture(holePosition: Vector2): void {
    this.isInHole = true;
    this.isMoving = false;
    this.velocity = { x: 0, y: 0 };
    this.position = { x: holePosition.x, y: holePosition.y };
  }

  private checkHoleSegment(from: Vector2, to: Vector2, holePosition: Vector2, holeRadius: number): boolean {
    const closest = closestPointOnSegment(holePosition, from, to);
    const dist = distance(closest, holePosition);
    if (dist >= holeRadius) return false;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (dist < holeRadius * PHYSICS.HOLE_INNER_RATIO || speed < PHYSICS.CAPTURE_SPEED) {
      this.capture(holePosition);
      return true;
    }
    return false;
  }

  private moveWithCollisions(fences: Fence[], holePosition: Vector2, holeRadius: number): boolean {
    this.depenetrate(fences);

    const stepScale = PHYSICS.FIXED_STEP * 60;
    const stepDist = Math.hypot(this.velocity.x, this.velocity.y) * stepScale;
    const chunks = Math.max(1, Math.ceil(stepDist / (this.radius * 0.5)));

    for (let i = 0; i < chunks; i++) {
      let remaining = {
        x: (this.velocity.x * stepScale) / chunks,
        y: (this.velocity.y * stepScale) / chunks,
      };

      for (let bounce = 0; bounce <= PHYSICS.MAX_BOUNCES_PER_CHUNK; bounce++) {
        if (Math.hypot(remaining.x, remaining.y) < 1e-12) break;

        const hit = this.findEarliestHit(fences, this.position, remaining);
        const t = hit ? hit.t : 1;
        const segTo = {
          x: this.position.x + remaining.x * t,
          y: this.position.y + remaining.y * t,
        };

        if (this.checkHoleSegment(this.position, segTo, holePosition, holeRadius)) return true;
        this.position = segTo;
        if (!hit) break;

        const n = hit.normal;
        const rest = { x: remaining.x * (1 - t), y: remaining.y * (1 - t) };
        const restNormal = rest.x * n.x + rest.y * n.y;
        const velNormal = this.velocity.x * n.x + this.velocity.y * n.y;

        if (velNormal < -1e-9) {
          const bounce = 1 + PHYSICS.RESTITUTION;
          rest.x -= bounce * restNormal * n.x;
          rest.y -= bounce * restNormal * n.y;
          this.velocity.x -= bounce * velNormal * n.x;
          this.velocity.y -= bounce * velNormal * n.y;
        } else {
          rest.x -= restNormal * n.x;
          rest.y -= restNormal * n.y;
          this.velocity.x -= velNormal * n.x;
          this.velocity.y -= velNormal * n.y;
        }

        this.position.x += n.x * 1e-6;
        this.position.y += n.y * 1e-6;
        remaining = rest;
      }

      this.depenetrate(fences);
    }
    return false;
  }

  private depenetrate(fences: Fence[]): void {
    for (const fence of fences) {
      const closest = closestPointOnSegment(this.position, fence.start, fence.end);
      const dist = distance(closest, this.position);
      if (dist >= this.radius) continue;
      if (dist > 1e-12) {
        const push = (this.radius - dist) / dist;
        this.position.x += (this.position.x - closest.x) * push;
        this.position.y += (this.position.y - closest.y) * push;
      } else {
        this.position.x += fence.normal.x * this.radius;
        this.position.y += fence.normal.y * this.radius;
      }
    }
  }

  private findEarliestHit(
    fences: Fence[],
    from: Vector2,
    delta: Vector2
  ): { t: number; normal: Vector2 } | null {
    const minDistAt = (t: number): number => {
      const p = { x: from.x + delta.x * t, y: from.y + delta.y * t };
      let min = Infinity;
      for (const fence of fences) {
        const d = distanceToFence(fence, p);
        if (d < min) min = d;
      }
      return min;
    };

    if (minDistAt(0) < this.radius) return null;
    if (minDistAt(1) >= this.radius && minDistAt(0.5) >= this.radius) return null;

    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (minDistAt(mid) < this.radius) hi = mid;
      else lo = mid;
    }

    const contact = { x: from.x + delta.x * hi, y: from.y + delta.y * hi };
    let bestFence: Fence | null = null;
    let bestDist = Infinity;
    for (const fence of fences) {
      const d = distanceToFence(fence, contact);
      if (d < bestDist) {
        bestDist = d;
        bestFence = fence;
      }
    }
    if (!bestFence) return null;

    const closest = closestPointOnSegment(contact, bestFence.start, bestFence.end);
    const nx = contact.x - closest.x;
    const ny = contact.y - closest.y;
    const len = Math.hypot(nx, ny);
    const normal = len > 1e-12 ? { x: nx / len, y: ny / len } : { ...bestFence.normal };
    return { t: hi, normal };
  }

  render(ctx: CanvasRenderingContext2D, tiltAngle: number): void {
    ctx.save();
    ctx.translate(this.position.x, this.position.y);
    ctx.scale(1, Math.cos(tiltAngle));
    ctx.scale(this.holeScale, this.holeScale);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(2, 3, this.radius, this.radius * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    const gradient = ctx.createRadialGradient(
      -this.radius * 0.3, -this.radius * 0.3, 0,
      0, 0, this.radius
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.7, '#f0f0f0');
    gradient.addColorStop(1, '#d0d0d0');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(-this.radius * 0.3, -this.radius * 0.3, this.radius * 0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
