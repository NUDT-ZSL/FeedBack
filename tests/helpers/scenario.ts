import { OpError } from '../../src/whiteboard/errors.ts';
import { History } from '../../src/whiteboard/history.ts';
import { type BoardOp } from '../../src/whiteboard/ops.ts';
import { cloneBoard, createBoard } from '../../src/whiteboard/state.ts';
import { hashState } from '../../src/whiteboard/serialize.ts';
import type { BoardState } from '../../src/whiteboard/types.ts';

export type ScenarioSignal =
  | { type: 'op'; op: BoardOp }
  | { type: 'undo' }
  | { type: 'redo' };

export interface ScenarioStep {
  name: string;
  signal: ScenarioSignal;
}

export interface ScenarioTraceEntry {
  index: number;
  name: string;
  hash: string;
  rejected: OpError['code'] | null;
}

export function runScenario(
  steps: ScenarioStep[],
  initial: BoardState = createBoard(),
): { state: BoardState; trace: ScenarioTraceEntry[] } {
  const state = cloneBoard(initial);
  const history = new History(state);
  const trace: ScenarioTraceEntry[] = [];

  steps.forEach((step, index) => {
    let rejected: OpError['code'] | null = null;
    try {
      if (step.signal.type === 'op') {
        history.execute(step.signal.op);
      } else if (step.signal.type === 'undo') {
        history.undo();
      } else {
        history.redo();
      }
    } catch (error) {
      if (error instanceof OpError) {
        rejected = error.code;
      } else {
        throw error;
      }
    }
    trace.push({ index, name: step.name, hash: hashState(state), rejected });
  });

  return { state, trace };
}

export function assertTracesEqual(left: ScenarioTraceEntry[], right: ScenarioTraceEntry[]): void {
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const leftEntry = left[i];
    const rightEntry = right[i];
    if (JSON.stringify(leftEntry) !== JSON.stringify(rightEntry)) {
      throw new Error(
        `state diverged at step ${i} "${leftEntry?.name ?? rightEntry?.name}": ` +
          `${JSON.stringify(leftEntry)} !== ${JSON.stringify(rightEntry)}`,
      );
    }
  }
}
