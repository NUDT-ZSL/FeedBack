import type { Element, Herb, Pill } from '../types.ts';

export const DEFAULT_AIRFLOW = 50;
export const DEFAULT_TEMPERATURE = 25;
export const BASE_FLAME_COLOR = '#e74c3c';
export const BASE_FLAME_HEIGHT = 80;

export type FurnaceStatus = 'idle' | 'refining' | 'conflicted' | 'exploded';

export type VerdictOutcome = 'none' | 'pill' | 'waste' | 'explode';

export type ConflictKind = 'duplicate' | 'restrain';

export type ConflictResolution = 'waste' | 'explode';

export interface IngredientRecord {
  seq: number;
  herb: Herb;
  addedAtTick: number;
}

export interface ConflictRecord {
  id: string;
  kind: ConflictKind;
  element: Element;
  otherElement: Element | null;
  existing: IngredientRecord;
  incoming: IngredientRecord;
  resolution: ConflictResolution;
  reason: string;
  active: boolean;
}

export interface PillVerdict {
  outcome: VerdictOutcome;
  pill: Pill | null;
  reason: string;
  basis: string[];
}

export type FurnaceEventType =
  | 'add'
  | 'undo'
  | 'clear'
  | 'airflow'
  | 'conflict'
  | 'verdict'
  | 'tick';

export interface FurnaceEvent {
  seq: number;
  type: FurnaceEventType;
  message: string;
  atTick: number;
}

interface FurnaceSnapshot {
  ingredients: IngredientRecord[];
  temperature: number;
  verdict: PillVerdict;
  removedRecord?: IngredientRecord;
}

export interface FurnaceState {
  id: string;
  name: string;
  ingredients: IngredientRecord[];
  airflow: number;
  temperature: number;
  flameColor: string;
  flameHeight: number;
  elements: Element[];
  status: FurnaceStatus;
  activeConflicts: ConflictRecord[];
  conflictHistory: ConflictRecord[];
  verdict: PillVerdict;
  log: FurnaceEvent[];
  undoStack: FurnaceSnapshot[];
}

export interface AddResult {
  furnaceId: string;
  record: IngredientRecord;
  conflicts: ConflictRecord[];
  verdict: PillVerdict;
}

export interface DropOutcome {
  outcome: VerdictOutcome;
  pill: Pill | null;
  reason: string;
  elements: Element[];
}

export type Rng = () => number;
