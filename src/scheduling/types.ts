export interface Loom {
  id: string;
  speedFactor: number;
  availableFrom: number;
}

export interface Capability {
  loomId: string;
  operationType: string;
  priority: number;
}

export interface Operation {
  id: string;
  orderId: string;
  type: string;
  dependsOn: string[];
  standardMinutes: number;
}

export interface Order {
  id: string;
  releaseAt: number;
  operations: Operation[];
}

export interface Policy {
  strictAdjudication: boolean;
}

export interface SchedulingInput {
  looms: Loom[];
  capabilities: Capability[];
  orders: Order[];
  policy?: Partial<Policy>;
}

export interface ScheduleBasis {
  releaseAt: number;
  depsReadyAt: number;
  readyAt: number;
  startedAt: number;
  reasons: string[];
}

export interface ScheduledOp {
  opId: string;
  orderId: string;
  loomId: string;
  start: number;
  end: number;
  workMinutes: number;
  basis: ScheduleBasis;
}

export interface AdjudicationCandidate {
  loomId: string;
  priority: number;
}

export type AdjudicationRule =
  | 'unique'
  | 'priority'
  | 'priority+loom-id-tiebreak'
  | 'none';

export interface Adjudication {
  opId: string;
  operationType: string;
  candidates: AdjudicationCandidate[];
  winner: string | null;
  rule: AdjudicationRule;
  ambiguous: boolean;
}

export type ScheduleFailure =
  | { kind: 'dependency-cycle'; cycle: string[] }
  | { kind: 'missing-dependency'; opId: string; missingOpId: string }
  | { kind: 'unknown-loom-reference'; loomId: string; operationType: string }
  | { kind: 'no-capable-loom'; opId: string; operationType: string }
  | { kind: 'ambiguous-coverage'; opId: string; operationType: string; candidates: AdjudicationCandidate[] };

export interface ScheduleResult {
  ok: boolean;
  scheduled: ScheduledOp[];
  adjudications: Adjudication[];
  failures: ScheduleFailure[];
}

export const DEFAULT_POLICY: Policy = {
  strictAdjudication: false,
};
