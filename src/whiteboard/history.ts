import { applyOp, type BoardOp } from './ops.ts';
import type { BoardState } from './types.ts';

interface HistoryEntry {
  op: BoardOp;
  inverse: BoardOp[];
}

export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private readonly state: BoardState;

  constructor(state: BoardState) {
    this.state = state;
  }

  execute(op: BoardOp): void {
    const inverse = applyOp(this.state, op);
    this.past.push({ op, inverse });
    this.future = [];
  }

  undo(): BoardOp | null {
    const entry = this.past.pop();
    if (!entry) return null;
    for (const inverseOp of entry.inverse) {
      applyOp(this.state, inverseOp);
    }
    this.future.push(entry);
    return entry.op;
  }

  redo(): BoardOp | null {
    const entry = this.future.pop();
    if (!entry) return null;
    const inverse = applyOp(this.state, entry.op);
    this.past.push({ op: entry.op, inverse });
    return entry.op;
  }

  get undoDepth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }
}
