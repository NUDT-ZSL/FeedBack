// Chain: stroke counting / win-fail state machine.
// Verifies the round state transitions: aiming -> rolling -> aiming,
// 'win' when the ball drops, 'fail' exactly when the stroke limit is
// reached, and that win takes precedence on the final allowed stroke.

import { describe, it, expect } from 'vitest';
import { simulateGame, Stroke, MAX_STROKES } from '../src/simulation';

const SEED = 31415;

/** Weak putt straight down: rolls away from the hole, never drops. */
const MISS: Stroke = { direction: { x: 0, y: 1 }, power: 2 };

/**
 * Deterministically searches a seed + power that holes out from the tee
 * by replaying the simulation (cheap and fully offline). If a physics
 * change makes hole-in-ones impossible, this throws and the win-chain
 * tests fail with a clear cause.
 */
function findWinningSetup(): { seed: number; stroke: Stroke } {
  for (const seed of [555, 31415, 7, 42, 100, 2024, 999, 12345, 2718, 161]) {
    const probe = simulateGame([], { seed });
    const dx = probe.course.holePosition.x - probe.course.teePosition.x;
    const dy = probe.course.holePosition.y - probe.course.teePosition.y;
    const len = Math.hypot(dx, dy);
    const direction = { x: dx / len, y: dy / len };

    for (let power = 2; power <= 14; power += 0.25) {
      const result = simulateGame([{ direction, power }], { seed });
      if (result.gameState === 'win') {
        return { seed, stroke: { direction, power } };
      }
    }
  }
  throw new Error('no hole-in-one found for any candidate seed');
}

describe('stroke limit / game state chain', () => {
  it('switches to fail exactly when the stroke limit is reached', () => {
    const strokes = Array.from({ length: MAX_STROKES }, () => MISS);
    const result = simulateGame(strokes, { seed: SEED });

    expect(result.strokeCount).toBe(MAX_STROKES);
    expect(result.isInHole).toBe(false);
    expect(result.gameState).toBe('fail');
    expect(result.strokes).toHaveLength(MAX_STROKES);
  });

  it('stays in aiming while strokes remain', () => {
    const result = simulateGame([MISS, MISS, MISS], { seed: SEED });
    expect(result.strokeCount).toBe(3);
    expect(result.gameState).toBe('aiming');
  });

  it('respects a custom stroke limit', () => {
    const result = simulateGame([MISS, MISS, MISS], { seed: SEED, maxStrokes: 2 });
    expect(result.strokeCount).toBe(2);
    expect(result.gameState).toBe('fail');
    expect(result.strokes).toHaveLength(2);
  });

  it('switches to win when the ball drops into the hole', () => {
    const setup = findWinningSetup();
    const result = simulateGame([setup.stroke], { seed: setup.seed });

    expect(result.gameState).toBe('win');
    expect(result.isInHole).toBe(true);
    expect(result.strokeCount).toBe(1);
    expect(result.strokes[0].isInHole).toBe(true);
  });

  it('win on the final allowed stroke beats the fail limit', () => {
    const setup = findWinningSetup();
    const result = simulateGame([setup.stroke], { seed: setup.seed, maxStrokes: 1 });
    expect(result.gameState).toBe('win');
    expect(result.strokeCount).toBe(1);
  });

  it('ignores strokes submitted after the round is over', () => {
    const setup = findWinningSetup();
    const result = simulateGame([setup.stroke, MISS, MISS], { seed: setup.seed });
    expect(result.gameState).toBe('win');
    expect(result.strokeCount).toBe(1);
    expect(result.strokes).toHaveLength(1);
  });

  it('accumulates stroke count across a multi-stroke round', () => {
    const setup = findWinningSetup();
    const result = simulateGame([MISS, MISS, setup.stroke], { seed: setup.seed, maxStrokes: 5 });
    // The winning putt only holes from the tee, so after two misses the
    // same stroke must not win; the round continues instead.
    expect(result.strokeCount).toBe(3);
    expect(result.gameState).toBe('aiming');
  });
});
