import { applyAction, step } from './engine';
import { createMatch } from './state';
import { FIXED_DT } from './constants';
import type { SimAction, SimState } from './types';

export interface TimedInput {
  t: number;
  action: SimAction;
}

export interface Scenario {
  name: string;
  seed: number;
  templateId: string;
  inputs?: TimedInput[];
}

export interface RunOptions {
  dt?: number;
  maxSteps?: number;
  stopOnFinish?: boolean;
  onStep?: (state: SimState, stepIndex: number) => void;
}

export function runMatch(
  scenario: Scenario,
  options: RunOptions = {}
): SimState {
  const dt = options.dt ?? FIXED_DT;
  const maxSteps = options.maxSteps ?? Math.ceil(130000 / (dt * 1000));
  const stopOnFinish = options.stopOnFinish ?? true;
  const inputs = [...(scenario.inputs ?? [])].sort((a, b) => a.t - b.t);

  let state = createMatch(scenario.seed, scenario.templateId);
  let inputIndex = 0;

  for (let i = 0; i < maxSteps; i++) {
    const tickStartMs = i * dt * 1000;
    while (inputIndex < inputs.length && inputs[inputIndex].t <= tickStartMs) {
      state = applyAction(state, inputs[inputIndex].action);
      inputIndex++;
    }
    state = step(state, dt);
    options.onStep?.(state, i);
    if (stopOnFinish && state.phase === 'finished') break;
  }
  return state;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0'));
}

export function stateHash(state: SimState): string {
  return hashString(stableStringify(state));
}
