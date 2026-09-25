// Chain: strokes - stroke counting, state transitions, fail at the
// stroke limit, win on capture, and full-game reproducibility.

import { HeadlessGame } from '../../src/headlessGame.ts';
import type { Snapshot } from '../../src/headlessGame.ts';
import { MAX_STROKES } from '../../src/rules.ts';
import { Harness } from '../harness.ts';

const WIN_SEED = 6; // verified: straight at the hole, full charge => win in 3

function dirToHole(g: HeadlessGame) {
  return {
    x: g.course.holePosition.x - g.ball.position.x,
    y: g.course.holePosition.y - g.ball.position.y
  };
}

function dirAwayFromHole(g: HeadlessGame) {
  return {
    x: g.ball.position.x - g.course.holePosition.x,
    y: g.ball.position.y - g.course.holePosition.y
  };
}

function playToWin(seed: number): Snapshot {
  const g = new HeadlessGame(1280, 720, seed);
  let guard = 0;
  while (g.state === 'aiming' && guard++ < MAX_STROKES + 1) {
    g.strike(dirToHole(g), 2000);
    g.runUntilSettled();
  }
  return g.snapshot();
}

export function register(h: Harness): void {
  h.test('strokes', 'reaching the stroke limit switches to fail', (t) => {
    const g = new HeadlessGame(1280, 720, 2024);
    const states: string[] = [];
    let guard = 0;
    while (g.state === 'aiming' && guard++ < MAX_STROKES + 1) {
      g.strike(dirAwayFromHole(g), 100); // weak putt away from the hole
      g.runUntilSettled();
      states.push(g.state);
    }
    t.equal(g.strokeCount, MAX_STROKES, 'stroke count at limit');
    t.equal(g.state, 'fail', 'state after final stroke settles');
    t.ok(!g.ball.isInHole, 'ball is not in the hole');
    t.ok(
      states.slice(0, MAX_STROKES - 1).every((s) => s === 'aiming'),
      `returns to aiming between strokes (got ${states.join(',')})`
    );
  });

  h.test('strokes', 'holing out switches to win with correct stroke count', (t) => {
    const g = new HeadlessGame(1280, 720, WIN_SEED);
    let guard = 0;
    while (g.state === 'aiming' && guard++ < MAX_STROKES + 1) {
      g.strike(dirToHole(g), 2000);
      g.runUntilSettled();
    }
    t.equal(g.state, 'win', 'final state');
    t.equal(g.strokeCount, 3, 'stroke count');
    t.ok(g.ball.isInHole, 'ball flagged as in hole');
  });

  h.test('strokes', 'stroke guard: cannot strike while ball is rolling', (t) => {
    const g = new HeadlessGame(1280, 720, 5);
    g.strike({ x: 1, y: 0 }, 500);
    let threw = false;
    try {
      g.strike({ x: 1, y: 0 }, 500);
    } catch {
      threw = true;
    }
    t.ok(threw, 'second strike while rolling throws');
    g.runUntilSettled();
    t.equal(g.strokeCount, 1, 'only one stroke counted');
    t.equal(g.state, 'aiming', 'back to aiming after settling');
  });

  h.test('strokes', 'full game is reproducible for fixed seed and shots', (t) => {
    t.equal(
      JSON.stringify(playToWin(WIN_SEED)),
      JSON.stringify(playToWin(WIN_SEED)),
      'same seed + same shots => same final snapshot'
    );
  });
}
