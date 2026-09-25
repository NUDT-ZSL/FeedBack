// Chain: random-source seeding / course generation / full-round replay.
// If terrain generation or physics randomness stops being reproducible,
// these tests fail.

import { describe, it, expect } from 'vitest';
import { simulateGame, Stroke } from '../src/simulation';
import { mulberry32 } from '../src/rng';

const SEED = 20260925;

const STROKES: Stroke[] = [
  { direction: { x: 1, y: 0.2 }, power: 9 },
  { direction: { x: 0.8, y: -0.4 }, power: 6 },
  { direction: { x: 1, y: 0 }, power: 4 }
];

describe('determinism chain', () => {
  it('mulberry32 produces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds produce different sequences', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('same seed generates an identical course layout', () => {
    const run1 = simulateGame([], { seed: SEED });
    const run2 = simulateGame([], { seed: SEED });
    expect(run1.course).toEqual(run2.course);
    expect(run1.course.terrainZones.length).toBeGreaterThan(0);
    expect(run1.course.fenceCount).toBeGreaterThan(0);
  });

  it('different seeds generate different course layouts', () => {
    const run1 = simulateGame([], { seed: SEED });
    const run2 = simulateGame([], { seed: SEED + 1 });
    expect(run1.course).not.toEqual(run2.course);
  });

  it('same seed + same strokes replays the identical round', () => {
    const run1 = simulateGame(STROKES, { seed: SEED });
    const run2 = simulateGame(STROKES, { seed: SEED });
    expect(run2).toEqual(run1);
    expect(run1.strokeCount).toBeGreaterThan(0);
  });

  it('same seed with a different deltaTime changes the trajectory', () => {
    const run1 = simulateGame(STROKES, { seed: SEED });
    const run2 = simulateGame(STROKES, { seed: SEED, deltaTime: 1 / 30 });
    expect(run2.finalPosition).not.toEqual(run1.finalPosition);
  });
});
