// Chain: fence - collision reflection, energy loss, containment
// (ball must never escape the fence loop), and reproducibility.

import { Ball } from '../../src/ball.ts';
import type { Fence } from '../../src/ball.ts';
import { HeadlessGame } from '../../src/headlessGame.ts';
import { Harness } from '../harness.ts';

const DT = 1 / 60;
const FAR_HOLE = { x: -100000, y: -100000 };

// Horizontal fence at y=100, inward normal pointing +y.
const WALL: Fence = {
  start: { x: 100, y: 100 },
  end: { x: 300, y: 100 },
  normal: { x: 0, y: 1 }
};

export function register(h: Harness): void {
  h.test('fence', 'head-on bounce reflects velocity inward and loses energy', (t) => {
    const ball = new Ball(200, 105);
    ball.applyForce({ x: 0, y: -1 }, 6);
    ball.update(DT, [], [WALL], FAR_HOLE, 18);
    // Step math: y 105 -> 99 (moves 6), speed 6*0.985=5.91, reflected,
    // damped *0.7 => vy=+4.137, pushed out to y=109 (radius 10 + 1).
    t.approx(ball.velocity.y, 4.137, 1e-9, 'vy after bounce');
    t.approx(ball.velocity.x, 0, 1e-12, 'vx stays zero');
    t.approx(ball.position.y, 109, 1e-9, 'pushed out of the wall');
    t.ok(ball.position.y > 100, 'ball ends on the inward side of the fence');
  });

  h.test('fence', 'ball outside collision range is unaffected', (t) => {
    const ball = new Ball(200, 50);
    ball.applyForce({ x: 1, y: 0 }, 5);
    ball.update(DT, [], [WALL], FAR_HOLE, 18);
    t.approx(ball.position.x, 205, 1e-9, 'x advances freely');
    t.approx(ball.velocity.y, 0, 1e-12, 'no phantom vertical velocity');
  });

  h.test('fence', 'full-power shot into boundary bounces and stays inside', (t) => {
    const run = () => {
      const g = new HeadlessGame(1280, 720, 11);
      g.strike({ x: 0, y: -1 }, 5000); // overcharged => max power straight up
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let bounced = false;
      let prevVy = g.ball.velocity.y;
      while (g.state === 'rolling') {
        g.step();
        minX = Math.min(minX, g.ball.position.x);
        maxX = Math.max(maxX, g.ball.position.x);
        minY = Math.min(minY, g.ball.position.y);
        maxY = Math.max(maxY, g.ball.position.y);
        if (prevVy < 0 && g.ball.velocity.y > 0) bounced = true;
        prevVy = g.ball.velocity.y;
      }
      return { g, minX, maxX, minY, maxY, bounced };
    };
    const r = run();
    t.ok(r.bounced, 'ball bounced off the top fence');
    // Fence loop sits at margin 80 with +/-20 sine wobble; ball radius 10.
    t.ok(
      r.minY > 59 && r.maxY < 661 && r.minX > 79 && r.maxX < 1201,
      `stayed inside fences (x ${r.minX.toFixed(2)}..${r.maxX.toFixed(2)}, y ${r.minY.toFixed(2)}..${r.maxY.toFixed(2)})`
    );
    const again = run();
    t.equal(
      JSON.stringify(again.g.snapshot()),
      JSON.stringify(r.g.snapshot()),
      'same seed bounce is reproducible'
    );
  });
}
