// Chain: full-round golden regression.
// Pins the exact outcome of a fixed seed + fixed stroke sequence:
// generated course layout, per-stroke resting positions and the final
// game state. Any change to physics parameters, terrain generation or
// capture/state logic fails the specific section that drifted.

import { describe, it, expect } from 'vitest';
import { simulateGame, Stroke } from '../src/simulation';

const SEED = 20260925;

const STROKES: Stroke[] = [
  { direction: { x: 1, y: 0.15 }, power: 10 },
  { direction: { x: 0.9, y: -0.35 }, power: 7 },
  { direction: { x: 1, y: 0.05 }, power: 5 }
];

// Tolerance for golden coordinates: exact same engine must be far
// closer than this; a real physics change moves these by much more.
const P = 8;

describe('full-chain golden regression (seed 20260925)', () => {
  const result = simulateGame(STROKES, { seed: SEED });

  it('generates the pinned course layout', () => {
    const c = result.course;
    expect(c.width).toBe(1280);
    expect(c.height).toBe(720);
    expect(c.teePosition.x).toBeCloseTo(188.51700596511364, P);
    expect(c.teePosition.y).toBeCloseTo(336.23444834025577, P);
    expect(c.holePosition.x).toBeCloseTo(1073.6010036012158, P);
    expect(c.holePosition.y).toBeCloseTo(425.2615472325124, P);
    expect(c.holeRadius).toBe(18);
    expect(c.fenceCount).toBe(34);

    expect(c.terrainZones.map((z) => z.type)).toEqual([
      'sand',
      'downhill',
      'downhill',
      'downhill',
      'sand'
    ]);

    const first = c.terrainZones[0];
    expect(first.center.x).toBeCloseTo(821.3636971579099, P);
    expect(first.center.y).toBeCloseTo(364.247478653642, P);
    expect(first.radius).toBeCloseTo(108.24878883548081, P);

    const slope = c.terrainZones[1];
    expect(slope.slopeAngle).toBeCloseTo(0.40178460653405634, P);
    expect(slope.slopeDirection!.x).toBeCloseTo(-0.006514316428817703, P);
    expect(slope.slopeDirection!.y).toBeCloseTo(0.9999787816156227, P);
  });

  it('reproduces the pinned per-stroke trajectory', () => {
    expect(result.strokes).toHaveLength(3);

    expect(result.strokes[0].endPosition.x).toBeCloseTo(864.1100158411296, P);
    expect(result.strokes[0].endPosition.y).toBeCloseTo(536.826897394783, P);
    expect(result.strokes[0].steps).toBe(314);
    expect(result.strokes[0].isInHole).toBe(false);

    expect(result.strokes[1].endPosition.x).toBeCloseTo(1119.3692338931974, P);
    expect(result.strokes[1].endPosition.y).toBeCloseTo(382.7165194891041, P);
    expect(result.strokes[1].steps).toBe(258);
    expect(result.strokes[1].isInHole).toBe(false);

    expect(result.strokes[2].endPosition.x).toBeCloseTo(1012.5979198161759, P);
    expect(result.strokes[2].endPosition.y).toBeCloseTo(395.1121750180754, P);
    expect(result.strokes[2].steps).toBe(236);
    expect(result.strokes[2].isInHole).toBe(false);
  });

  it('reproduces the pinned final outcome', () => {
    expect(result.finalPosition.x).toBeCloseTo(1012.5979198161759, P);
    expect(result.finalPosition.y).toBeCloseTo(395.1121750180754, P);
    expect(result.isInHole).toBe(false);
    expect(result.strokeCount).toBe(3);
    expect(result.maxStrokes).toBe(10);
    expect(result.gameState).toBe('aiming');
  });
});
