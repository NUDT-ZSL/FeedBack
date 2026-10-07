import { create } from "zustand";
import {
  Adjudication,
  applyMutation,
  BatchReport,
  CaseMutation,
  runBatch,
  runCase,
  SimConfig,
  SimOutput,
  StreamEvent,
  BatchCase,
  validateConfig,
} from "@/engine";

export interface ChangeLogEntry {
  name: string;
  impactStart: number;
  resumedFromSnapshot: boolean;
  ok: boolean;
  failures: string[];
  at: number;
}

interface SimState {
  rawEvents: StreamEvent[];
  config: SimConfig;
  adjudications: Adjudication[];
  output: SimOutput | null;
  blockingIssues: string[];
  allIssues: string[];
  changeLog: ChangeLogEntry[];
  selectedSwitchId: string | null;
  sourceFilter: string | null;
  batchReports: BatchReport[] | null;

  loadEvents: (events: StreamEvent[]) => void;
  setConfig: (config: SimConfig) => void;
  run: () => void;
  applyChange: (mutation: CaseMutation, label?: string) => void;
  adjudicate: (a: Adjudication) => void;
  selectSwitch: (id: string | null) => void;
  setSourceFilter: (s: string | null) => void;
  runBatchCases: (cases: BatchCase[]) => void;
}

export const useSimStore = create<SimState>((set, get) => ({
  rawEvents: [],
  config: { baseConsumeRate: 2, tiers: [] },
  adjudications: [],
  output: null,
  blockingIssues: [],
  allIssues: [],
  changeLog: [],
  selectedSwitchId: null,
  sourceFilter: null,
  batchReports: null,

  loadEvents: (events) => {
    set({ rawEvents: events, changeLog: [], selectedSwitchId: null });
    get().run();
  },
  setConfig: (config) => {
    set({ config });
    get().run();
  },
  run: () => {
    const { rawEvents, config, adjudications } = get();
    const outcome = runCase(rawEvents, config, adjudications);
    set({
      output: outcome.output,
      blockingIssues: outcome.blockingIssues,
      allIssues: outcome.allIssues,
    });
  },
  applyChange: (mutation, label) => {
    const { output, config, adjudications, changeLog } = get();
    if (!output) return;
    const r = applyMutation(output, output.normEvents, config, mutation, adjudications);
    const entry: ChangeLogEntry = {
      name: label ?? r.name,
      impactStart: r.impactStart,
      resumedFromSnapshot: r.resumedFromSnapshot,
      ok: r.report.ok,
      failures: r.report.failures,
      at: Date.now(),
    };
    const nextAdj =
      mutation.kind === "adjudicate"
        ? [...adjudications, mutation.adjudication]
        : adjudications;
    const nextConfig =
      mutation.kind === "tierThreshold"
        ? { ...config, tiers: config.tiers.map((t) => t.id === mutation.tierId ? { ...t, threshold: mutation.threshold } : t) }
        : mutation.kind === "tierRate"
          ? { ...config, tiers: config.tiers.map((t) => t.id === mutation.tierId ? { ...t, consumeRate: mutation.consumeRate } : t) }
          : config;
    // 变更后重新校验配置，保持冲突/裁决提示实时准确
    r.incremental.configIssues = validateConfig(nextConfig, nextAdj);
    set({
      output: r.incremental,
      rawEvents: r.incremental.normEvents.map((e) => ({
        id: e.id,
        sourceId: e.sourceId,
        arrivalTime: e.arrivalTime,
        payload: e.payload,
      })),
      config: nextConfig,
      adjudications: nextAdj,
      changeLog: [...changeLog, entry],
      blockingIssues: [],
    });
  },
  adjudicate: (a) => {
    const { output, adjudications } = get();
    if (!output) {
      // 推演被未裁决冲突阻塞：先记录裁决，再整体重推恢复
      set({ adjudications: [...adjudications, a] });
      get().run();
      return;
    }
    get().applyChange({ kind: "adjudicate", adjudication: a }, `人工裁决 ${a.id}`);
  },
  selectSwitch: (id) => set({ selectedSwitchId: id }),
  setSourceFilter: (s) => set({ sourceFilter: s }),
  runBatchCases: (cases) => set({ batchReports: runBatch(cases) }),
}));
