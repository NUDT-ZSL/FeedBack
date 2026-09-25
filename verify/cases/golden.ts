// Chain: golden - replay pinned scenarios and compare the final
// snapshot field by field against verify/golden.ts.

import { HeadlessGame } from '../../src/headlessGame.ts';
import type { Snapshot } from '../../src/headlessGame.ts';
import { GOLDENS } from '../golden.ts';
import type { GoldenCase } from '../golden.ts';
import { Harness } from '../harness.ts';

function replay(gc: GoldenCase): Snapshot {
  const g = new HeadlessGame(1280, 720, gc.seed);
  for (const [aim, chargeMs] of gc.shots) {
    if (g.state !== 'aiming') break;
    let dir;
    if (aim === 'hole') {
      dir = {
        x: g.course.holePosition.x - g.ball.position.x,
        y: g.course.holePosition.y - g.ball.position.y
      };
    } else if (aim === 'away') {
      dir = {
        x: g.ball.position.x - g.course.holePosition.x,
        y: g.ball.position.y - g.course.holePosition.y
      };
    } else {
      dir = { x: 0, y: -1 };
    }
    g.strike(dir, chargeMs);
    g.runUntilSettled();
  }
  return g.snapshot();
}

export function register(h: Harness): void {
  for (const gc of GOLDENS) {
    h.test(gc.chain, gc.name, (t) => {
      const snap = replay(gc);
      t.equal(snap.state, gc.expected.state, 'final state');
      t.equal(snap.strokeCount, gc.expected.strokeCount, 'stroke count');
      t.equal(snap.isInHole, gc.expected.isInHole, 'isInHole');
      t.approx(snap.x, gc.expected.x, 1e-9, 'final x');
      t.approx(snap.y, gc.expected.y, 1e-9, 'final y');
    });
  }
}
