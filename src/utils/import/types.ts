export type IssueLevel = 'info' | 'warning' | 'error';

export interface ImportIssue {
  level: IssueLevel;
  code: string;
  field?: string;
  message: string;
}

export type RawRecord = Record<string, unknown>;

export interface NormalizedRecord {
  row: number;
  title: string;
  year: number | null;
  director: string;
  genre: string[];
  rating: number | null;
  watchDate: string | null;
  watched: boolean | null;
  externalId: string | null;
  source: string;
  issues: ImportIssue[];
  raw: RawRecord;
}

export type RecordAction = 'added' | 'merged' | 'duplicate' | 'pending' | 'skipped';

export interface MergeCandidate {
  kind: 'existing' | 'import';
  id: string;
  title: string;
  year: number | null;
  source: string;
  reason: string;
}

export interface ImportRecordResult {
  row: number;
  title: string;
  year: number | null;
  source: string;
  action: RecordAction;
  targetId?: string;
  issues: ImportIssue[];
  candidates?: MergeCandidate[];
  filledFields?: string[];
  reason?: string;
  clusterKey: string;
}

export interface PendingCluster {
  clusterKey: string;
  reason: string;
  candidates: MergeCandidate[];
  records: { row: number; title: string; year: number | null; source: string }[];
}

export interface ImportReport {
  batchId: string;
  importedAt: string;
  totalRows: number;
  added: number;
  merged: number;
  duplicate: number;
  pending: number;
  skipped: number;
  recordResults: ImportRecordResult[];
  pendingClusters: PendingCluster[];
  decisions: PendingDecision[];
  decisionsApplied: string[];
}

export type PendingDecision =
  | { type: 'skip'; decidedAt: string }
  | { type: 'merge'; targetId: string; decidedAt: string }
  | { type: 'add'; recordId: string; decidedAt: string };

export interface ImportBatchDecisions {
  batchId: string;
  decisions: Record<string, PendingDecision>;
}
