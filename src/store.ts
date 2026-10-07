import { create } from 'zustand';
import { deriveState } from './engine/incremental.ts';
import { generateSampleScenario } from './engine/sample.ts';
import type { DeriveState, ManualAdjudication, Scenario } from './engine/types.ts';

export type DispositionFilter = 'all' | 'kept' | 'dropped' | 'consumed';

interface AppState {
  scenario: Scenario;
  state: DeriveState;
  selectedSource: string | 'all';
  timeRange: [number, number] | null;
  selectedSwitchId: string | null;
  dispositionFilter: DispositionFilter;
  /** 来源到达速率倍率编辑暂存 */
  rateMultipliers: Record<string, number>;

  replaceScenario: (scenario: Scenario) => void;
  /** 基于当前场景做变更并增量重推 */
  mutateScenario: (mutate: (scenario: Scenario) => Scenario, multiplierReset?: boolean) => void;
  setSelectedSource: (source: string | 'all') => void;
  setTimeRange: (range: [number, number] | null) => void;
  setSelectedSwitch: (id: string | null) => void;
  setDispositionFilter: (filter: DispositionFilter) => void;
  setRateMultiplier: (source: string, multiplier: number) => void;
  applyRateMultipliers: () => void;
  addAdjudication: (adjudication: ManualAdjudication) => void;
}

const initialScenario = generateSampleScenario('demo', {
  sources: 3,
  durationTicks: 400,
  seed: 42,
});

export const useAppStore = create<AppState>((set, get) => ({
  scenario: initialScenario,
  state: deriveState(initialScenario),
  selectedSource: 'all',
  timeRange: null,
  selectedSwitchId: null,
  dispositionFilter: 'all',
  rateMultipliers: {},

  replaceScenario: (scenario) =>
    set({
      scenario,
      state: deriveState(scenario),
      selectedSource: 'all',
      timeRange: null,
      selectedSwitchId: null,
      rateMultipliers: {},
    }),

  mutateScenario: (mutate) => {
    const { scenario, state } = get();
    const next = mutate(structuredClone(scenario));
    // 传入上一次推导状态 -> 自动增量重推（仅受影响来源/区间重算）
    set({ scenario: next, state: deriveState(next, state) });
  },

  setSelectedSource: (selectedSource) => set({ selectedSource }),
  setTimeRange: (timeRange) => set({ timeRange }),
  setSelectedSwitch: (selectedSwitchId) => set({ selectedSwitchId }),
  setDispositionFilter: (dispositionFilter) => set({ dispositionFilter }),

  setRateMultiplier: (source, multiplier) =>
    set({ rateMultipliers: { ...get().rateMultipliers, [source]: multiplier } }),

  applyRateMultipliers: () => {
    const { rateMultipliers, mutateScenario } = get();
    const active = Object.entries(rateMultipliers).filter(([, m]) => m > 0 && m !== 1);
    if (active.length === 0) return;
    mutateScenario((scenario) => {
      for (const [source, multiplier] of active) {
        scenario.events = scenario.events.map((event) =>
          event.source === source
            ? { ...event, tick: Math.floor(event.tick / multiplier) }
            : event,
        );
      }
      return scenario;
    });
    set({ rateMultipliers: {} });
  },

  addAdjudication: (adjudication) => {
    get().mutateScenario((scenario) => {
      scenario.config.adjudications = [
        ...(scenario.config.adjudications ?? []).filter(
          (a) => !(a.source === adjudication.source && a.tick === adjudication.tick),
        ),
        adjudication,
      ];
      return scenario;
    });
  },
}));
