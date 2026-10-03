import assert from 'node:assert/strict';
import type { EngineState } from '../src/trajectory/engine.ts';
import { TrajectoryEngine } from '../src/trajectory/engine.ts';
import type { InferenceParams, LocationPoint } from '../src/trajectory/types.ts';

export function canonicalState(state: EngineState): string {
  return JSON.stringify(state);
}

export function assertStateEqual(actual: EngineState, expected: EngineState, context: string): void {
  assert.strictEqual(
    canonicalState(actual),
    canonicalState(expected),
    `状态与全量重推不一致: ${context}`,
  );
}

export function fullRecomputeState(points: LocationPoint[], params: InferenceParams): EngineState {
  const engine = new TrajectoryEngine(params);
  engine.load(points);
  return engine.getState();
}
