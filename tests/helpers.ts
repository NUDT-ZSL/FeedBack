import { Ball, PHYSICS } from '../src/ball.ts';
import type { Fence, TerrainZone, Vector2 } from '../src/ball.ts';
import { mulberry32 } from '../src/rng.ts';

export { Ball, PHYSICS };
export { mulberry32 };

export function fence(x1: number, y1: number, x2: number, y2: number, normal?: Vector2): Fence {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const n = normal ?? { x: -dy / len, y: dx / len };
  return { start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, normal: n };
}

export function zone(type: TerrainZone['type'], x: number, y: number, radius: number, extra?: Partial<TerrainZone>): TerrainZone {
  return { type, center: { x, y }, radius, ...extra };
}

export interface StepArgs {
  zones?: TerrainZone[];
  fences?: Fence[];
  hole?: Vector2;
  holeRadius?: number;
  rngSeed?: number;
}

export function runSteps(ball: Ball, count: number, args: StepArgs = {}): void {
  const rng = mulberry32(args.rngSeed ?? 1);
  for (let i = 0; i < count; i++) {
    ball.stepFixed(
      args.zones ?? [],
      args.fences ?? [],
      args.hole ?? { x: 0, y: 0 },
      args.holeRadius ?? 18,
      rng
    );
  }
}

export function runUntilStopped(ball: Ball, args: StepArgs = {}, maxSteps = 100000): number {
  const rng = mulberry32(args.rngSeed ?? 1);
  let steps = 0;
  while (ball.isMoving && !ball.isInHole && steps < maxSteps) {
    ball.stepFixed(
      args.zones ?? [],
      args.fences ?? [],
      args.hole ?? { x: 0, y: 0 },
      args.holeRadius ?? 18,
      rng
    );
    steps++;
  }
  return steps;
}

export function distToFence(f: Fence, p: Vector2): number {
  const dx = f.end.x - f.start.x;
  const dy = f.end.y - f.start.y;
  const lenSq = dx * dx + dy * dy;
  let t = ((p.x - f.start.x) * dx + (p.y - f.start.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = f.start.x + t * dx;
  const cy = f.start.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

export function snapshot(ball: Ball): { x: number; y: number; vx: number; vy: number } {
  return { x: ball.position.x, y: ball.position.y, vx: ball.velocity.x, vy: ball.velocity.y };
}
