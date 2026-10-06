/**
 * 界面状态层：所有问诊操作都只追加/裁决记录，再调用独立推演引擎取结论。
 * 页面组件不保存任何辨证中间状态，避免同一组输入在不同入口下结论不一致。
 */
import { create } from 'zustand';
import { DiagnosisSession } from '@/engine/session';
import type {
  InferenceResult,
  ObservationKind,
  ObservationRecord,
} from '@/engine/types';

interface ClinicState {
  session: DiagnosisSession;
  records: ObservationRecord[];
  result: InferenceResult;
  collect: (
    kind: ObservationKind,
    key: string,
    value: string,
    source: string
  ) => void;
  adjudicate: (kind: ObservationKind, key: string, acceptId: string) => void;
  correct: (recordId: string, newValue: string, source?: string) => void;
  loadFixture: (records: ObservationRecord[]) => void;
  reset: () => void;
}

function snapshot(session: DiagnosisSession) {
  return { records: session.getRecords(), result: session.getResult() };
}

export const useClinicStore = create<ClinicState>((set, get) => {
  const session = new DiagnosisSession(undefined, () => Date.now());
  return {
    session,
    records: [],
    result: session.getResult(),

    collect: (kind, key, value, source) => {
      get().session.collect(kind, key, value, source);
      set(snapshot(get().session));
    },

    adjudicate: (kind, key, acceptId) => {
      get().session.adjudicate(kind, key, acceptId);
      set(snapshot(get().session));
    },

    correct: (recordId, newValue, source) => {
      get().session.correct(recordId, newValue, source);
      set(snapshot(get().session));
    },

    loadFixture: (records) => {
      const next = new DiagnosisSession(undefined, () => Date.now());
      for (const r of records) {
        const created = next.collect(r.kind, r.key, r.value, r.source, r.collectedAt);
        if (r.status === 'adjudicated') next.adjudicate(r.kind, r.key, created.id);
      }
      set({ session: next, ...snapshot(next) });
    },

    reset: () => {
      const next = new DiagnosisSession(undefined, () => Date.now());
      set({ session: next, ...snapshot(next) });
    },
  };
});

export const KIND_LABEL: Record<ObservationKind, string> = {
  symptom: '症状',
  pulse: '脉象',
  tongue: '舌象',
  constitution: '体质',
  history: '病史',
};
