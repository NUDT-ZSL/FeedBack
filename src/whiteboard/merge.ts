import { OpError, type OpErrorCode } from './errors.ts';
import { History } from './history.ts';
import { applyOp, type BoardOp } from './ops.ts';
import { cloneBoard, subtreeIds } from './state.ts';
import { ROOT_ID, type BoardState } from './types.ts';

export interface OpRecord {
  op: BoardOp;
  client: string;
  clock: number;
  seq: number;
}

export class Client {
  readonly log: OpRecord[] = [];
  history: History;
  private clock = 0;
  readonly id: string;
  state: BoardState;

  constructor(id: string, state: BoardState) {
    this.id = id;
    this.state = state;
    this.history = new History(state);
  }

  dispatch(op: BoardOp): OpRecord {
    this.history.execute(op);
    this.clock += 1;
    const record: OpRecord = { op, client: this.id, clock: this.clock, seq: this.log.length };
    this.log.push(record);
    return record;
  }

  adopt(state: BoardState): void {
    this.state = cloneBoard(state);
    this.history = new History(this.state);
    this.log.length = 0;
  }
}

export type MergeConflictType =
  | 'field'
  | 'move'
  | 'delete-wins'
  | 'delete-vs-move-into'
  | 'delete-vs-add-into'
  | 'cycle';

export interface MergeConflict {
  type: MergeConflictType;
  elementId: string;
  field?: string;
  detail: string;
  kept: OpRecord;
  dropped: OpRecord;
}

export interface DroppedOp {
  record: OpRecord;
  reason: OpErrorCode | 'target-deleted' | 'already-deleted';
}

export interface MergeReport {
  applied: OpRecord[];
  conflicts: MergeConflict[];
  dropped: DroppedOp[];
}

export interface MergeResult {
  state: BoardState;
  report: MergeReport;
}

function compareRecords(a: OpRecord, b: OpRecord): number {
  if (a.clock !== b.clock) return a.clock - b.clock;
  if (a.client !== b.client) return a.client < b.client ? -1 : 1;
  return a.seq - b.seq;
}

export function mergeClients(base: BoardState, clients: Client[]): MergeResult {
  const queue = clients.flatMap((client) => client.log).sort(compareRecords);
  const state = cloneBoard(base);
  const deletedBy = new Map<string, OpRecord>();
  const fieldWrites = new Map<string, OpRecord>();
  const moveWrites = new Map<string, OpRecord>();
  const applied: OpRecord[] = [];
  const conflicts: MergeConflict[] = [];
  const dropped: DroppedOp[] = [];

  const dropWithError = (record: OpRecord, error: unknown): void => {
    if (error instanceof OpError) {
      dropped.push({ record, reason: error.code });
      if (error.code === 'CYCLE' && record.op.kind === 'move') {
        conflicts.push({
          type: 'cycle',
          elementId: record.op.id,
          detail: `move rejected during merge: ${error.message}`,
          kept: record,
          dropped: record,
        });
      }
      return;
    }
    throw error;
  };

  for (const record of queue) {
    const op = record.op;

    if (op.kind === 'add') {
      if (state.nodes[op.element.id] || deletedBy.has(op.element.id)) {
        dropped.push({ record, reason: 'DUPLICATE_ID' });
        continue;
      }
      let parentId = op.parentId ?? ROOT_ID;
      const parentDelete = parentId === ROOT_ID ? undefined : deletedBy.get(parentId);
      if (parentDelete) {
        conflicts.push({
          type: 'delete-vs-add-into',
          elementId: op.element.id,
          detail: `parent "${parentId}" was deleted concurrently; element re-attached to root`,
          kept: parentDelete,
          dropped: record,
        });
        parentId = ROOT_ID;
      }
      try {
        applyOp(state, { ...op, parentId });
        applied.push(record);
      } catch (error) {
        dropWithError(record, error);
      }
      continue;
    }

    if (op.kind === 'update') {
      const deleter = deletedBy.get(op.id);
      if (deleter) {
        dropped.push({ record, reason: 'target-deleted' });
        conflicts.push({
          type: 'delete-wins',
          elementId: op.id,
          detail: `update to deleted element "${op.id}" discarded; delete confirmed by "${deleter.client}"`,
          kept: deleter,
          dropped: record,
        });
        continue;
      }
      try {
        applyOp(state, op);
        applied.push(record);
        for (const field of Object.keys(op.patch)) {
          const key = `${op.id}.${field}`;
          const previous = fieldWrites.get(key);
          if (previous && previous.client !== record.client) {
            conflicts.push({
              type: 'field',
              elementId: op.id,
              field,
              detail: `concurrent writes to "${key}"; later write by "${record.client}" wins deterministically`,
              kept: record,
              dropped: previous,
            });
          }
          fieldWrites.set(key, record);
        }
      } catch (error) {
        dropWithError(record, error);
      }
      continue;
    }

    if (op.kind === 'move') {
      const deleter = deletedBy.get(op.id);
      if (deleter) {
        dropped.push({ record, reason: 'target-deleted' });
        conflicts.push({
          type: 'delete-wins',
          elementId: op.id,
          detail: `move of deleted element "${op.id}" discarded; delete confirmed by "${deleter.client}"`,
          kept: deleter,
          dropped: record,
        });
        continue;
      }
      let parentId = op.parentId;
      const parentDelete = parentId === ROOT_ID ? undefined : deletedBy.get(parentId);
      if (parentDelete) {
        conflicts.push({
          type: 'delete-vs-move-into',
          elementId: op.id,
          detail: `target group "${parentId}" was deleted concurrently; element preserved at root`,
          kept: parentDelete,
          dropped: record,
        });
        parentId = ROOT_ID;
      }
      try {
        applyOp(state, { ...op, parentId });
        applied.push(record);
        const previousMove = moveWrites.get(op.id);
        if (previousMove && previousMove.client !== record.client) {
          conflicts.push({
            type: 'move',
            elementId: op.id,
            detail: `concurrent moves of "${op.id}"; later move by "${record.client}" wins deterministically`,
            kept: record,
            dropped: previousMove,
          });
        }
        moveWrites.set(op.id, record);
      } catch (error) {
        dropWithError(record, error);
      }
      continue;
    }

    const deleter = deletedBy.get(op.id);
    if (deleter) {
      dropped.push({ record, reason: 'already-deleted' });
      continue;
    }
    try {
      const removedIds = state.nodes[op.id] ? subtreeIds(state, op.id) : [];
      applyOp(state, op);
      applied.push(record);
      for (const id of removedIds) {
        deletedBy.set(id, record);
      }
    } catch (error) {
      dropWithError(record, error);
    }
  }

  return { state, report: { applied, conflicts, dropped } };
}
