// Chain: hole capture judgment.
// Covers the speed x distance matrix of the capture rule:
//   in hole if dist < holeRadius AND (speed < 8 OR dist < holeRadius * 0.5)
// Each case positions the ball so that after exactly one physics step it
// is at the target distance with the target speed, then checks the call.

import { describe, it, expect } from 'vitest';
import { Ball, Vector2 } from '../src/ball';

const DT = 1 / 60;
const HOLE: Vector2 = { x: 500, y: 500 };
const HOLE_RADIUS = 18;
const GRASS_FRICTION = 0.985;

/**
 * Places the ball so that after one update it sits `targetDist` from the
 * hole moving at `targetSpeed` (pre-capture), and returns the ball after
 * that single update.
 */
function judgeOneStep(targetDist: number, targetSpeed: number): Ball {
  // The ball moves `speed` px per step (DT=1/60 => *60) and friction is
  // applied before the hole check, so launch slightly faster/farther.
  const launchSpeed = targetSpeed / GRASS_FRICTION;
  const startDist = targetDist + launchSpeed * DT * 60;
  const ball = new Ball(HOLE.x - startDist, HOLE.y);
  ball.velocity = { x: launchSpeed, y: 0 };
  ball.isMoving = true;
  ball.update(DT, [], [], HOLE, HOLE_RADIUS);
  return ball;
}

describe('hole capture chain', () => {
  it('captures a slow ball near the hole edge (dist < R, speed < 8)', () => {
    const ball = judgeOneStep(HOLE_RADIUS - 4, 5);
    expect(ball.isInHole).toBe(true);
    expect(ball.isMoving).toBe(false);
    expect(ball.velocity).toEqual({ x: 0, y: 0 });
  });

  it('captures a fast ball dead center (dist < R/2, speed >= 8)', () => {
    const ball = judgeOneStep(HOLE_RADIUS * 0.4, 15);
    expect(ball.isInHole).toBe(true);
  });

  it('rejects a fast ball near the hole edge (R/2 <= dist < R, speed >= 8)', () => {
    const ball = judgeOneStep(HOLE_RADIUS - 4, 12);
    expect(ball.isInHole).toBe(false);
    expect(ball.isMoving).toBe(true);
  });

  it('ignores a ball outside the hole radius even at low speed', () => {
    const ball = judgeOneStep(HOLE_RADIUS + 3, 2);
    expect(ball.isInHole).toBe(false);
  });

  it('boundary: exactly half-radius distance captures even at high speed', () => {
    const ball = judgeOneStep(HOLE_RADIUS * 0.5 - 0.5, 20);
    expect(ball.isInHole).toBe(true);
  });

  it('boundary: speed just under 8 captures at the edge', () => {
    const ball = judgeOneStep(HOLE_RADIUS - 2, 7.5);
    expect(ball.isInHole).toBe(true);
  });

  it('boundary: speed just over 8 at the edge lips out', () => {
    const ball = judgeOneStep(HOLE_RADIUS - 2, 8.5);
    expect(ball.isInHole).toBe(false);
  });

  it('a ball resting in the hole shrinks and stays captured', () => {
    const ball = judgeOneStep(2, 1);
    expect(ball.isInHole).toBe(true);
    const scaleBefore = ball.holeScale;
    ball.update(DT, [], [], HOLE, HOLE_RADIUS);
    expect(ball.holeScale).toBeLessThan(scaleBefore);
    expect(ball.isInHole).toBe(true);
  });
});
