import type { CanvasElement } from '../types';

/**
 * Lamport clock with a site (userId) tie-breaker. The pair is totally
 * ordered, which is what makes conflict resolution deterministic on
 * every replica regardless of message arrival order.
 */
export interface Clock {
  lamport: number;
  site: string;
}

export function compareClock(a: Clock, b: Clock): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  return a.site < b.site ? -1 : a.site > b.site ? 1 : 0;
}

/**
 * A single incremental change. `baseVersion` is the server version the
 * client had when it produced the op (used for staleness checks, not for
 * merging). `lamport` + `userId` form the merge clock.
 */
export type Op =
  | { kind: 'add'; opId: string; userId: string; lamport: number; baseVersion: number; element: CanvasElement }
  | { kind: 'update'; opId: string; userId: string; lamport: number; baseVersion: number; elementId: string; updates: Partial<CanvasElement> }
  | { kind: 'delete'; opId: string; userId: string; lamport: number; baseVersion: number; elementId: string };

export function clockOf(op: Op): Clock {
  return { lamport: op.lamport, site: op.userId };
}

export interface VersionedOp {
  version: number;
  op: Op;
}

export type ClientMessage =
  | { type: 'hello'; userId: string; lastVersion: number | null }
  | { type: 'op'; op: Op };

export type ServerMessage =
  | { type: 'sync'; elements: CanvasElement[]; version: number }
  | { type: 'synced'; version: number }
  | { type: 'catchup'; ops: VersionedOp[]; version: number }
  | { type: 'op'; version: number; op: Op }
  | { type: 'ack'; opId: string; version: number }
  | { type: 'reject'; opId: string; reason: string; version: number }
  | { type: 'join'; userId: string; timestamp: number }
  | { type: 'leave'; userId: string; timestamp: number }
  | { type: 'users'; count: number; userIds: string[] };
