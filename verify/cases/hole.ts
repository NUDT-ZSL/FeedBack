// Chain: hole - capture rule across speed x distance combinations.
// Rule under test (ball.ts): inside holeRadius, the ball drops when
// speed < 8 OR distance < holeRadius * 0.5; otherwise it lips out.
//
// Setup: hole at (400,300) radius 18, ball launched from (400-d, 300)
// with speed s along +x. One update moves it s pixels closer, so the
// checked distance is |d - s| and the checked speed is s * 0.985.

import { Ball } from '../../src/ball.ts';
import { Harness } from '../harness.ts';

const DT = 1 / 60;
const HOLE = { x: 400, y: 300 };
const HOLE_R = 18;

function oneStep(d: number, s: number): Ball {
  const ball = new Ball(HOLE.x - d, HOLE.y);
  ball.applyForce({ x: 1, y: 0 }, s);
  ball.update(DT, [], [], HOLE, HOLE_R);
  return ball;
}

export function register(h: Harness): void {
  const cases: Array<{ name: string; d: number; s: number; expected: boolean }> = [
    // dist 15 < 18, speed 4.93 < 8 -> drops
    { name: 'slow ball inside hole drops', d: 20, s: 5, expected: true },
    // dist 13 < 18, speed 11.82 >= 8, 13 >= 9 -> lips out
    { name: 'fast ball at hole edge lips out', d: 25, s: 12, expected: false },
    // dist 8 < 9 (half radius) -> drops despite speed 11.82
    { name: 'fast ball dead center drops', d: 20, s: 12, expected: true },
    // dist 35 >= 18 -> rolls on
    { name: 'ball outside hole continues', d: 40, s: 5, expected: false },
    // dist 13, speed 6.90 < 8 -> drops
    { name: 'medium ball under speed limit drops', d: 20, s: 7, expected: true },
    // dist 13, speed 8.87 >= 8 -> lips out
    { name: 'medium ball over speed limit lips out', d: 22, s: 9, expected: false },
    // dist exactly 9 = half radius (not < 9), speed 11.82 -> lips out
    { name: 'exactly half radius at high speed lips out', d: 21, s: 12, expected: false },
    // dist 11.9, speed 7.98 just under 8 -> drops
    { name: 'just under speed threshold drops', d: 20, s: 8.1, expected: true },
    // dist 11.8, speed 8.08 just over 8 -> lips out
    { name: 'just over speed threshold lips out', d: 20, s: 8.2, expected: false }
  ];

  for (const c of cases) {
    h.test('hole', c.name, (t) => {
      const ball = oneStep(c.d, c.s);
      const dist = Math.abs(c.d - c.s);
      const speed = c.s * 0.985;
      t.equal(
        ball.isInHole,
        c.expected,
        `dist=${dist.toFixed(2)} speed=${speed.toFixed(2)} => isInHole`
      );
    });
  }

  h.test('hole', 'captured ball stops and shrink animation progresses', (t) => {
    const ball = oneStep(20, 5);
    t.ok(ball.isInHole, 'ball is captured');
    t.equal(ball.isMoving, false, 'isMoving cleared');
    t.equal(ball.velocity.x, 0, 'vx zeroed');
    t.equal(ball.velocity.y, 0, 'vy zeroed');
    const scaleBefore = ball.holeScale;
    ball.update(DT, [], [], HOLE, HOLE_R);
    t.ok(ball.holeScale < scaleBefore, 'holeScale shrinks after capture');
  });
}
