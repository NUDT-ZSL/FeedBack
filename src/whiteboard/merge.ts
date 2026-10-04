import type { BoardState } from './types.ts';
import type { ElementPatch, Op } from './ops.ts';
import { applyOp } from './apply.ts';
import { OpRejection } from './errors.ts';
import { Board } from './history.ts';

export interface OpEnvelope {
  clientId: string;
  lamport: number;
  op: Op;
}

export type ConflictResolution = 'superseded' | 'skipped';

export interface ConflictRecord {
  op: OpEnvelope;
  resolution: ConflictResolution;
  reason: string;
  winner?: OpEnvelope;
}

export function envelopeKey(env: OpEnvelope): string {
  return `${env.clientId}:${env.lamport}`;
}

export function compareEnvelopes(a: OpEnvelope, b: OpEnvelope): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.clientId !== b.clientId) return a.clientId < b.clientId ? -1 : 1;
  return 0;
}

export function mergeLogs(a: OpEnvelope[], b: OpEnvelope[]): OpEnvelope[] {
  const byKey = new Map<string, OpEnvelope>();
  for (const env of [...a, ...b]) {
    byKey.set(envelopeKey(env), env);
  }
  return [...byKey.values()].sort(compareEnvelopes);
}

function describeRejection(err: OpRejection): string {
  switch (err.code) {
    case 'UPDATE_MISSING':
      return 'update target no longer exists; it was concurrently removed (remove wins)';
    case 'REMOVE_MISSING':
      return 'remove target was already removed by a concurrent operation';
    case 'MOVE_MISSING':
    case 'REORDER_MISSING':
      return 'operation target no longer exists; it was concurrently removed';
    case 'MOVE_MISSING_PARENT':
      return 'target group no longer exists; it was concurrently removed or ungrouped';
    case 'UNGROUP_MISSING':
      return 'group no longer exists; it was concurrently removed or ungrouped';
    case 'ADD_DUPLICATE_ID':
      return 'concurrent add used the same element id; first writer in merged order wins';
    case 'GROUP_ID_TAKEN':
      return 'concurrent group creation used the same group id; first writer wins';
    case 'GROUP_MISSING_ELEMENT':
      return 'group member no longer exists; it was concurrently removed or moved';
    default:
      return `operation could not be applied during merge: ${err.message}`;
  }
}

export interface ReplayResult {
  state: BoardState;
  conflicts: ConflictRecord[];
}

export function replay(base: BoardState, log: OpEnvelope[]): ReplayResult {
  let state = base;
  const conflicts: ConflictRecord[] = [];
  const fieldWriters = new Map<string, { env: OpEnvelope; value: unknown }>();
  const movers = new Map<string, OpEnvelope>();

  const recordConcurrentRemoval = (
    removedIds: Set<string>,
    remover: OpEnvelope,
  ): void => {
    for (const [key, entry] of fieldWriters) {
      const id = key.split('.')[0];
      if (removedIds.has(id) && entry.env.clientId !== remover.clientId) {
        conflicts.push({
          op: entry.env,
          resolution: 'superseded',
          winner: remover,
          reason: `element '${id}' updated by ${entry.env.clientId}#${entry.env.lamport} was concurrently removed by ${remover.clientId}#${remover.lamport}; remove wins`,
        });
        fieldWriters.delete(key);
      }
    }
    for (const [id, env] of movers) {
      if (removedIds.has(id) && env.clientId !== remover.clientId) {
        conflicts.push({
          op: env,
          resolution: 'superseded',
          winner: remover,
          reason: `element '${id}' moved by ${env.clientId}#${env.lamport} was concurrently removed by ${remover.clientId}#${remover.lamport}; remove wins`,
        });
        movers.delete(id);
      }
    }
  };

  for (const env of log) {
    const op = env.op;
    try {
      const next = applyOp(state, op);

      if (op.type === 'update') {
        for (const [field, value] of Object.entries(op.patch as ElementPatch)) {
          const key = `${op.id}.${field}`;
          const previous = fieldWriters.get(key);
          if (previous && previous.value !== value) {
            conflicts.push({
              op: previous.env,
              resolution: 'superseded',
              winner: env,
              reason: `concurrent updates to '${key}' with different values; later writer ${env.clientId}#${env.lamport} wins over ${previous.env.clientId}#${previous.env.lamport}`,
            });
          }
          fieldWriters.set(key, { env, value });
        }
      } else if (op.type === 'move') {
        const previous = movers.get(op.id);
        if (previous) {
          conflicts.push({
            op: previous,
            resolution: 'superseded',
            winner: env,
            reason: `concurrent moves of '${op.id}'; later move ${env.clientId}#${env.lamport} wins over ${previous.clientId}#${previous.lamport}`,
          });
        }
        movers.set(op.id, env);
      } else if (op.type === 'remove') {
        const removed = new Set<string>();
        const walk = (id: string): void => {
          removed.add(id);
          for (const childId of state.childOrder[id] ?? []) walk(childId);
        };
        walk(op.id);
        recordConcurrentRemoval(removed, env);
      }

      state = next;
    } catch (err) {
      if (err instanceof OpRejection) {
        conflicts.push({
          op: env,
          resolution: 'skipped',
          reason: describeRejection(err),
        });
      } else {
        throw err;
      }
    }
  }

  return { state, conflicts };
}

export class Client {
  readonly clientId: string;
  private base: BoardState;
  board: Board;
  log: OpEnvelope[] = [];
  conflicts: ConflictRecord[] = [];
  private clock = 0;

  constructor(clientId: string, base: BoardState) {
    this.clientId = clientId;
    this.base = base;
    this.board = new Board(base);
  }

  get state(): BoardState {
    return this.board.state;
  }

  dispatchLocal(op: Op): OpEnvelope {
    this.board.dispatch(op);
    this.clock += 1;
    const env: OpEnvelope = { clientId: this.clientId, lamport: this.clock, op };
    this.log.push(env);
    return env;
  }

  absorb(merged: OpEnvelope[]): void {
    this.log = merged;
    this.clock = merged.reduce((max, env) => Math.max(max, env.lamport), 0);
    const { state, conflicts } = replay(this.base, merged);
    this.board = new Board(state);
    this.conflicts = conflicts;
  }

  syncWith(other: Client): void {
    const merged = mergeLogs(this.log, other.log);
    this.absorb(merged);
  }
}

export function syncClients(...clients: Client[]): void {
  let merged: OpEnvelope[] = [];
  for (const client of clients) {
    merged = mergeLogs(merged, client.log);
  }
  for (const client of clients) {
    client.absorb(merged);
  }
}
