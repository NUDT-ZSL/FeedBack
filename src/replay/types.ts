export interface SpatialRecord {
  id: string;
  objectId: string;
  field: string;
  value: string;
  observedAt: number;
  source: string;
  corrects?: string;
}

export interface KeyEvent {
  id: string;
  objectId: string;
  kind: string;
  occurredAt: number;
  links: string[];
}

export interface Adjudication {
  conflictId: string;
  winnerRecordId: string;
  rationale: string;
}

export interface ReplayInput {
  records: SpatialRecord[];
  events: KeyEvent[];
  adjudications?: Adjudication[];
}

export type DiagnosticKind =
  | "missing-link"
  | "link-cycle"
  | "unresolved-conflict"
  | "dangling-correction"
  | "unknown-adjudication";

export interface Diagnostic {
  severity: "error" | "warning";
  kind: DiagnosticKind;
  message: string;
  refs: string[];
}

export interface ConflictGroup {
  conflictId: string;
  objectId: string;
  field: string;
  observedAt: number;
  recordIds: string[];
  resolved: boolean;
  winnerRecordId?: string;
}

export interface FieldState {
  value: string;
  recordId: string;
  observedAt: number;
}

export type ObjectState = Record<string, FieldState>;

export interface EventImpact {
  objects: string[];
  timeRange: [number, number];
}

export interface ReplayResult {
  objectStates: Record<string, ObjectState>;
  eventImpacts: Record<string, EventImpact>;
  conflicts: ConflictGroup[];
  diagnostics: Diagnostic[];
}

export interface AffectedScope {
  objects: string[];
  eventIds: string[];
  timeRange: [number, number];
  reason: string;
}
