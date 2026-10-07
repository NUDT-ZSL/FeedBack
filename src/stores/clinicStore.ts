/**
 * 问诊室状态：页面组件只通过本 store 与推演引擎交互，
 * 四诊采集、裁决、辨证、增量重推全部委托给 DeductionSession，
 * 页面自身不再持有任何推演规则。
 */
import { create } from 'zustand';
import {
  DeductionSession,
  type Adjudication,
  type CollectionConflict,
  type CollectionRecord,
  type DeductionResult,
  type ExamSource,
  type RecordKind,
} from '@/diagnosis';

let session = new DeductionSession();

interface ClinicState {
  records: CollectionRecord[];
  conflicts: CollectionConflict[];
  result: DeductionResult | null;
  /** 逻辑时刻：每次采集 +1，由 store 统一供给，保证可复现。 */
  logicalClock: number;
  collect: (kind: RecordKind, key: string, value: string, source: ExamSource, note?: string) => void;
  correct: (recordId: string, newValue: string) => void;
  adjudicate: (adjudication: Adjudication) => void;
  /** 全量辨证。 */
  deduce: () => void;
  reset: () => void;
}

export const useClinicStore = create<ClinicState>((set, get) => ({
  records: [],
  conflicts: [],
  result: null,
  logicalClock: 0,

  collect: (kind, key, value, source, note) => {
    const recordedAt = get().logicalClock + 1;
    session.collect({ kind, key, value, source, recordedAt, note });
    set({ records: session.getRecords(), conflicts: session.getConflicts(), logicalClock: recordedAt });
  },

  correct: (recordId, newValue) => {
    const record = session.correctRecord(recordId, newValue);
    // 修正记录后只增量重推受影响的证候与方剂。
    const result = get().result
      ? session.deduceIncremental([`${record.kind}:${record.key}`])
      : get().result;
    set({ records: session.getRecords(), conflicts: session.getConflicts(), result });
  },

  adjudicate: (adjudication) => {
    session.adjudicate(adjudication);
    // 裁决后只增量重推受影响的证候与方剂。
    const result = get().result
      ? session.deduceIncremental([`${adjudication.kind}:${adjudication.key}`])
      : get().result;
    set({ records: session.getRecords(), conflicts: session.getConflicts(), result });
  },

  deduce: () => {
    set({ result: session.deduceFull(), conflicts: session.getConflicts() });
  },

  reset: () => {
    session = new DeductionSession();
    set({ records: [], conflicts: [], result: null, logicalClock: 0 });
  },
}));
