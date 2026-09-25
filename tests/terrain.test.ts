// Chain: terrain friction / slope forces / direction deviation.
// Verifies speed decay and direction stability per terrain type with
// fixed random input, and that each terrain changes the outcome in the
// expected direction (sand slows more, downhill carries further, ...).

import { describe, it, expect, afterEach } from 'vitest';
import { Ball, TerrainZone, Vector2 } from '../src/ball';
import { seedRandom, resetRandomSource } from '../src/rng';

const DT = 1 / 60;
const START: Vector2 = { x: 500, y: 500 };
// Hole far away so it never interferes with friction measurements.
const FAR_HOLE: Vector2 = { x: -100000, y: -100000 };

afterEach(() => resetRandomSource());

function bigZone(partial: Partial<TerrainZone> & { type: TerrainZone['type'] }): TerrainZone[] {
  // Bounded zone (radius 200 around the launch point): the ball crosses
  // it and then keeps rolling on plain grass, mirroring real courses.
  return [{ center: { ...START }, radius: 200, ...partial }];
}

function rollUntilStop(terrain: TerrainZone[], velocity: Vector2): Ball {
  const ball = new Ball(START.x, START.y);
  ball.velocity = { ...velocity };
  ball.isMoving = true;
  let steps = 0;
  while (ball.isMoving && steps < 100000) {
    ball.update(DT, terrain, [], FAR_HOLE, 18);
    steps++;
  }
  return ball;
}

function travelDistance(ball: Ball): number {
  return Math.hypot(ball.position.x - START.x, ball.position.y - START.y);
}

describe('terrain friction chain', () => {
  const launch: Vector2 = { x: 5, y: 0 };

  it('sand decelerates the ball much faster than grass', () => {
    const grassBall = rollUntilStop([], launch);
    const sandBall = rollUntilStop(bigZone({ type: 'sand' }), launch);

    const grassDist = travelDistance(grassBall);
    const sandDist = travelDistance(sandBall);
    expect(sandDist).toBeLessThan(grassDist * 0.5);
    expect(grassDist).toBeGreaterThan(0);
  });

  it('downhill carries the ball further than flat grass', () => {
    seedRandom(7);
    const grassBall = rollUntilStop([], launch);
    seedRandom(7);
    const downhillBall = rollUntilStop(
      bigZone({ type: 'downhill', slopeAngle: 0.3, slopeDirection: { x: 1, y: 0 } }),
      launch
    );
    expect(travelDistance(downhillBall)).toBeGreaterThan(travelDistance(grassBall));
  });

  it('uphill stops the ball sooner than flat grass', () => {
    seedRandom(7);
    const grassBall = rollUntilStop([], launch);
    seedRandom(7);
    const uphillBall = rollUntilStop(
      bigZone({ type: 'uphill', slopeAngle: 0.3, slopeDirection: { x: 1, y: 0 } }),
      launch
    );
    expect(travelDistance(uphillBall)).toBeLessThan(travelDistance(grassBall));
  });

  it('slope deviation is reproducible under a fixed seed', () => {
    const zone = bigZone({ type: 'downhill', slopeAngle: 0.4, slopeDirection: { x: 1, y: 0 } });
    seedRandom(123);
    const first = rollUntilStop(zone, launch);
    seedRandom(123);
    const second = rollUntilStop(zone, launch);
    expect(second.position).toEqual(first.position);
    expect(second.velocity).toEqual(first.velocity);
  });

  it('slope deviation actually deflects the ball off its launch line', () => {
    const zone = bigZone({ type: 'downhill', slopeAngle: 0.5, slopeDirection: { x: 1, y: 0 } });
    seedRandom(99);
    const ball = rollUntilStop(zone, launch);
    // Launched along y=0; random deviation must push it off the axis.
    expect(Math.abs(ball.position.y - START.y)).toBeGreaterThan(0.001);
  });

  it('ball always comes to rest (speed decays below the stop threshold)', () => {
    for (const type of ['sand', 'uphill', 'downhill'] as const) {
      seedRandom(11);
      const ball = rollUntilStop(
        bigZone({ type, slopeAngle: 0.3, slopeDirection: { x: 1, y: 0 } }),
        launch
      );
      expect(ball.isMoving).toBe(false);
      expect(ball.velocity).toEqual({ x: 0, y: 0 });
    }
  });
});
