import {
  createMatch,
  step,
  FIXED_DT,
} from '../src/sim';
import type { SimPlayer, SimState } from '../src/sim';
import type { Ball } from '../src/types';

export function makeState(seed = 1, templateId = 'zhang-jun'): SimState {
  return createMatch(seed, templateId);
}

export function withBall(state: SimState, patch: Partial<Ball>): SimState {
  return {
    ...state,
    ball: {
      x: 400,
      y: 250,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      rotation: 0,
      isMoving: false,
      isBouncing: false,
      ...patch,
    },
  };
}

export function withPlayer(state: SimState, patch: Partial<SimPlayer>): SimState {
  return { ...state, player: { ...state.player, ...patch } };
}

export function advance(state: SimState, steps: number, dt = FIXED_DT): SimState[] {
  const trace: SimState[] = [];
  let current = state;
  for (let i = 0; i < steps; i++) {
    current = step(current, dt);
    trace.push(current);
  }
  return trace;
}

export function normalizeAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value < -Math.PI) value += 2 * Math.PI;
  return value;
}
