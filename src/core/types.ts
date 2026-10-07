import { Element, Herb, Pill } from '../types';

export type ConflictKind = 'duplicate' | 'restraint';

export type OutcomeKind = 'pending' | 'pill' | 'waste' | 'explosion';

export interface ConflictParty {
  herbId: string;
  herbName: string;
  element: Element;
}

export interface ConflictRecord {
  kind: ConflictKind;
  element: Element;
  existing: ConflictParty[];
  incoming: ConflictParty;
  reason: string;
  resolution: string;
}

export interface AddOperation {
  kind: 'add';
  seq: number;
  herb: Herb;
  airflow: number;
}

export type FurnaceOperation = AddOperation;

export interface TraceEvent {
  seq: number;
  furnaceId: string;
  type: 'add' | 'conflict' | 'outcome';
  summary: string;
  detail: string;
}

export interface BatchOutcome {
  batchSeq: number;
  kind: OutcomeKind;
  pill: Pill | null;
  conflict: ConflictRecord | null;
  basis: string[];
}

export interface FurnaceRuntime {
  id: string;
  name: string;
  operations: FurnaceOperation[];
  ingredients: Herb[];
  elementSources: Record<string, string[]>;
  airflow: number;
  temperature: number;
  targetTemperature: number;
  flameColor: string;
  flameHeight: number;
  status: OutcomeKind;
  cooldownUntil: number;
  lastOutcome: BatchOutcome | null;
  outcomes: BatchOutcome[];
  trace: TraceEvent[];
}

export interface AddResult {
  accepted: boolean;
  outcome: BatchOutcome | null;
}
