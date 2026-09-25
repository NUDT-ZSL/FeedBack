// Chain: terrain - friction decay and slope deviation per terrain type,
// plus reproducibility of seeded course generation and trajectories.

import { Ball } from '../../src/ball.ts';
import type { TerrainZone } from '../../src/ball.ts';
import { HeadlessGame } from '../../src/headlessGame.ts';
import { mulberry32 } from '../../src/rng.ts';
import { Harness } from '../harness.ts';

const DT = 1 / 60;
const FAR_HOLE = { x: -100000, y: -100000 };

function rollBall(zones: TerrainZone[], vx: number, vy: number, seed: number) {
  const ball = new Ball(640, 360, mulberry32(seed));
  ball.applyForce({ x: vx, y: vy }, Math.hypot(vx, vy));
  const speeds: number[] = [];
  let steps = 0;
  while (ball.isMoving && steps < 20000) {
    ball.update(DT, zones, [], FAR_HOLE, 18);
    speeds.push(Math.hypot(ball.velocity.x, ball.velocity.y));
    steps++;
  }
  return { ball, steps, speeds };
}

function courseLayout(seed: number): string {
  const g = new HeadlessGame(1280, 720, seed);
  return JSON.stringify({
    tee: g.course.teePosition,
    hole: g.course.holePosition,
    zones: g.course.terrainZones
  });
}

function playScripted(seed: number): string {
  const g = new HeadlessGame(1280, 720, seed);
  const snaps: unknown[] = [];
  for (let i = 0; i < 3 && g.state === 'aiming'; i++) {
    g.strike(
      {
        x: g.course.holePosition.x - g.ball.position.x,
        y: g.course.holePosition.y - g.ball.position.y
      },
      800 + i * 300
    );
    g.runUntilSettled();
    snaps.push(g.snapshot());
  }
  return JSON.stringify(snaps);
}

const sandZone: TerrainZone = { type: 'sand', center: { x: 640, y: 360 }, radius: 500 };
const uphillZone: TerrainZone = {
  type: 'uphill',
  center: { x: 640, y: 360 },
  radius: 500,
  slopeAngle: 0.4,
  slopeDirection: { x: 1, y: 0 }
};
const downhillZone: TerrainZone = {
  type: 'downhill',
  center: { x: 640, y: 360 },
  radius: 500,
  slopeAngle: 0.4,
  slopeDirection: { x: 1, y: 0 }
};

export function register(h: Harness): void {
  h.test('terrain', 'seeded course generation is reproducible', (t) => {
    t.equal(courseLayout(42), courseLayout(42), 'same seed => same layout');
    t.ok(courseLayout(42) !== courseLayout(43), 'different seed => different layout');
  });

  h.test('terrain', 'full trajectory is reproducible for fixed seed and shots', (t) => {
    t.equal(playScripted(7), playScripted(7), 'same seed + same shots => same trajectory');
  });

  h.test('terrain', 'grass decelerates smoothly and monotonically', (t) => {
    const { speeds } = rollBall([], 6, 0, 1);
    t.ok(speeds.length > 100, `grass roll should take many steps, took ${speeds.length}`);
    t.ok(speeds[0] < 6, `speed after first step ${speeds[0]} should be below launch 6`);
    let monotonic = true;
    for (let i = 1; i < speeds.length; i++) {
      if (speeds[i] > speeds[i - 1]) monotonic = false;
    }
    t.ok(monotonic, 'speed must never increase on flat grass');
  });

  h.test('terrain', 'sand stops the ball much faster than grass', (t) => {
    const grass = rollBall([], 6, 0, 1);
    const sand = rollBall([sandZone], 6, 0, 1);
    t.ok(
      sand.steps < grass.steps / 2,
      `sand steps (${sand.steps}) should be well below grass steps (${grass.steps})`
    );
  });

  h.test('terrain', 'uphill opposes motion, downhill pushes along slope', (t) => {
    const grass = rollBall([], 4, 0, 1);
    const uphill = rollBall([uphillZone], 4, 0, 1);
    const downhill = rollBall([downhillZone], 4, 0, 1);
    t.ok(
      uphill.steps < grass.steps,
      `uphill steps (${uphill.steps}) should be fewer than grass (${grass.steps})`
    );
    t.ok(
      downhill.speeds[0] > grass.speeds[0],
      `downhill speed after step 1 (${downhill.speeds[0]}) should exceed grass (${grass.speeds[0]})`
    );
  });

  h.test('terrain', 'slope deviation is seeded: stable per seed, varies across seeds', (t) => {
    const a1 = rollBall([downhillZone], 4, 0, 11);
    const a2 = rollBall([downhillZone], 4, 0, 11);
    const b = rollBall([downhillZone], 4, 0, 22);
    t.equal(a1.ball.position.x, a2.ball.position.x, 'same seed final x');
    t.equal(a1.ball.position.y, a2.ball.position.y, 'same seed final y');
    t.ok(
      a1.ball.position.x !== b.ball.position.x || a1.ball.position.y !== b.ball.position.y,
      'different seeds should deviate to different landing spots'
    );
  });
}
