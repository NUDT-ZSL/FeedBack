import { describe, expect, it } from 'vitest';
import {
  BOILING_HOLD_MS,
  DRYNESS_THRESHOLD,
  FRAGMENTATION_THRESHOLD,
  PRESS_DURATION_MS,
  UNIFORMITY_THRESHOLD,
  createInitialState,
  createPaperMachine,
  reduce,
  type MachineState,
} from '@/state/paperMachine';
import { calculateDryness, calculateUniformity } from '@/utils/paperMath';

function steadyDragPositions(count: number, speed = 1): { x: number; y: number; t: number }[] {
  const positions: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({ x: i * speed * 16, y: 0, t: i * 16 });
  }
  return positions;
}

function jitterDragPositions(count: number): { x: number; y: number; t: number }[] {
  const positions: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i < count; i++) {
    const jitter = i % 2 === 0 ? 4 : 96;
    positions.push({ x: i * jitter, y: (i % 3) * 40, t: i * 16 });
  }
  return positions;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function advanceToBeating(state: MachineState): MachineState {
  let s = reduce(state, { type: 'BAMBOO_OVER_VAT' }).state;
  s = reduce(s, { type: 'TICK_BOILING', deltaMs: BOILING_HOLD_MS }).state;
  return s;
}

function advanceToScooping(state: MachineState): MachineState {
  let s = advanceToBeating(state);
  for (let i = 0; i < 40; i++) {
    s = reduce(s, { type: 'HIT_PESTLE' }).state;
  }
  s = reduce(s, { type: 'SIEVE' }).state;
  return s;
}

function advanceToDrying(state: MachineState): MachineState {
  let s = advanceToScooping(state);
  s = reduce(s, { type: 'SCOOP_DRAG', positions: steadyDragPositions(10) }).state;
  s = reduce(s, { type: 'PRESS' }).state;
  s = reduce(s, { type: 'TICK_PRESS', deltaMs: PRESS_DURATION_MS }).state;
  return s;
}

describe('paperMachine stage transitions', () => {
  it('walks the full happy path from boiling to finished', () => {
    let state = createInitialState(0.5);
    expect(state.stage).toBe('boiling_idle');

    state = reduce(state, { type: 'BAMBOO_OVER_VAT' }).state;
    expect(state.stage).toBe('boiling_active');

    const half = reduce(state, { type: 'TICK_BOILING', deltaMs: BOILING_HOLD_MS / 2 });
    expect(half.state.stage).toBe('boiling_active');
    expect(half.state.paper.boilingProgress).toBe(50);
    expect(half.effects.some((e) => e.type === 'steam')).toBe(true);

    const done = reduce(state, { type: 'TICK_BOILING', deltaMs: BOILING_HOLD_MS });
    expect(done.state.stage).toBe('beating_active');
    expect(done.state.paper.boilingProgress).toBe(100);
    state = done.state;

    for (let i = 0; i < 40; i++) {
      state = reduce(state, { type: 'HIT_PESTLE' }).state;
    }
    expect(state.paper.fragmentationLevel).toBe(80);

    state = reduce(state, { type: 'SIEVE' }).state;
    expect(state.stage).toBe('scooping_active');

    state = reduce(state, { type: 'SCOOP_DRAG', positions: steadyDragPositions(10) }).state;
    expect(state.paper.uniformity).toBeGreaterThanOrEqual(UNIFORMITY_THRESHOLD);

    state = reduce(state, { type: 'PRESS' }).state;
    expect(state.pressing).toBe(true);

    const pressed = reduce(state, { type: 'TICK_PRESS', deltaMs: PRESS_DURATION_MS });
    expect(pressed.state.stage).toBe('drying_active');
    expect(pressed.effects.some((e) => e.type === 'waterdrop')).toBe(true);
    state = pressed.state;

    state = reduce(state, { type: 'SET_LIGHT', intensity: 100 }).state;
    const dried = reduce(state, { type: 'TICK_DRYING', deltaMs: 5000 });
    expect(dried.state.paper.dryness).toBeGreaterThanOrEqual(DRYNESS_THRESHOLD);
    expect(dried.state.stage).toBe('finished');
    expect(dried.effects.some((e) => e.type === 'finished')).toBe(true);
  });

  it('ignores events that are not allowed in the current stage', () => {
    const idle = createInitialState(0.5);
    expect(reduce(idle, { type: 'HIT_PESTLE' }).state).toBe(idle);
    expect(reduce(idle, { type: 'SIEVE' }).state).toBe(idle);
    expect(reduce(idle, { type: 'SCOOP_DRAG', positions: steadyDragPositions(5) }).state).toBe(idle);
    expect(reduce(idle, { type: 'PRESS' }).state).toBe(idle);
    expect(reduce(idle, { type: 'TICK_DRYING', deltaMs: 1000 }).state).toBe(idle);
    expect(reduce(idle, { type: 'SET_LIGHT', intensity: 80 }).state).toBe(idle);
  });

  it('resets boiling progress when the bamboo leaves the vat early', () => {
    let state = reduce(createInitialState(0.5), { type: 'BAMBOO_OVER_VAT' }).state;
    state = reduce(state, { type: 'TICK_BOILING', deltaMs: BOILING_HOLD_MS / 2 }).state;
    expect(state.paper.boilingProgress).toBe(50);
    state = reduce(state, { type: 'BAMBOO_LEAVE_VAT' }).state;
    expect(state.stage).toBe('boiling_idle');
    expect(state.paper.boilingProgress).toBe(0);
  });

  it('blocks sieving below the fragmentation threshold', () => {
    let state = advanceToBeating(createInitialState(0.5));
    for (let i = 0; i < 30; i++) {
      state = reduce(state, { type: 'HIT_PESTLE' }).state;
    }
    expect(state.paper.fragmentationLevel).toBeLessThan(FRAGMENTATION_THRESHOLD);
    expect(reduce(state, { type: 'SIEVE' }).state.stage).toBe('beating_active');
  });

  it('blocks pressing below the uniformity threshold', () => {
    let state = advanceToScooping(createInitialState(0.5));
    state = reduce(state, { type: 'SCOOP_DRAG', positions: jitterDragPositions(12) }).state;
    expect(state.paper.uniformity).toBeLessThan(UNIFORMITY_THRESHOLD);
    const result = reduce(state, { type: 'PRESS' });
    expect(result.state.pressing).toBe(false);
    expect(result.state.stage).toBe('scooping_active');
  });
});

describe('paperMachine quality regression (state overwrite)', () => {
  it('merges rapid consecutive scoop drags instead of overwriting uniformity', () => {
    const machine = createPaperMachine(advanceToScooping(createInitialState(0.5)));
    const drags = [steadyDragPositions(6), jitterDragPositions(8), steadyDragPositions(10)];

    let expectedUniformity = 0;
    let expectedWeight = 0;
    for (const positions of drags) {
      const scoopUniformity = calculateUniformity(positions);
      const totalWeight = expectedWeight + positions.length;
      expectedUniformity =
        (expectedUniformity * expectedWeight + scoopUniformity * positions.length) / totalWeight;
      expectedWeight = totalWeight;
      machine.dispatch({ type: 'SCOOP_DRAG', positions });
    }

    const { paper, scoopWeight } = machine.getState();
    expect(scoopWeight).toBe(24);
    expect(paper.uniformity).toBeCloseTo(expectedUniformity, 10);
    expect(paper.uniformity).not.toBeCloseTo(calculateUniformity(drags[2]), 5);
  });

  it('keeps dryness monotonic across interleaved drying ticks and drags', () => {
    const machine = createPaperMachine(advanceToDrying(createInitialState(0.5)));
    machine.dispatch({ type: 'SET_LIGHT', intensity: 80 });

    let expectedDryness = 0;
    for (let i = 0; i < 20; i++) {
      machine.dispatch({ type: 'TICK_DRYING', deltaMs: 100 });
      machine.dispatch({ type: 'SCOOP_DRAG', positions: steadyDragPositions(4) });
      expectedDryness = calculateDryness(expectedDryness, 80, 100);
    }

    const { paper } = machine.getState();
    expect(paper.dryness).toBeCloseTo(expectedDryness, 10);
    expect(paper.dryness).toBeGreaterThan(0);
  });

  it('batch-verifies quality outcomes across randomized rapid-drag sessions', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const random = mulberry32(seed);
      const machine = createPaperMachine(advanceToScooping(createInitialState(random())));

      let expectedUniformity = 0;
      let expectedWeight = 0;
      const dragCount = 3 + Math.floor(random() * 8);
      for (let d = 0; d < dragCount; d++) {
        const count = 3 + Math.floor(random() * 20);
        const positions: { x: number; y: number; t: number }[] = [];
        for (let i = 0; i < count; i++) {
          positions.push({ x: random() * 300, y: random() * 200, t: i * 16 });
        }
        const scoopUniformity = calculateUniformity(positions);
        const totalWeight = expectedWeight + count;
        expectedUniformity =
          (expectedUniformity * expectedWeight + scoopUniformity * count) / totalWeight;
        expectedWeight = totalWeight;
        machine.dispatch({ type: 'SCOOP_DRAG', positions });
      }

      const { paper } = machine.getState();
      expect(paper.uniformity).toBeCloseTo(expectedUniformity, 8);
      expect(paper.uniformity).toBeGreaterThanOrEqual(0);
      expect(paper.uniformity).toBeLessThanOrEqual(100);
    }
  });

  it('batch-verifies drying stays monotonic and finishes at the threshold', () => {
    for (const light of [0, 25, 50, 75, 100]) {
      const machine = createPaperMachine(advanceToDrying(createInitialState(0.5)));
      machine.dispatch({ type: 'SET_LIGHT', intensity: light });

      let previous = 0;
      let ticks = 0;
      while (machine.getState().stage === 'drying_active' && ticks < 300) {
        machine.dispatch({ type: 'TICK_DRYING', deltaMs: 100 });
        const dryness = machine.getState().paper.dryness;
        expect(dryness).toBeGreaterThanOrEqual(previous);
        previous = dryness;
        ticks++;
      }

      const { stage, paper } = machine.getState();
      if (light === 0) {
        expect(paper.dryness).toBeGreaterThan(0);
      }
      expect(stage).toBe('finished');
      expect(paper.dryness).toBeGreaterThanOrEqual(DRYNESS_THRESHOLD);
    }
  });
});
