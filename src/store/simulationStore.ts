/**
 * 界面状态仓库：只持有推演输入与引擎产物。
 *
 * 任何界面交互（滑块、场景切换）都走同一流程：
 *   修改参数 → 增量推演（供展示）+ 整体重算（做一致性比对）
 * 界面层不自行计算任何水利数值。
 */
import { create } from 'zustand';
import { runFull } from '@/simulation/engine';
import { runIncremental } from '@/simulation/incremental';
import { baseParams, scenarios } from '@/simulation/scenarios';
import type { SimulationParams, SimulationResult } from '@/simulation/types';
import { resultFingerprint, resultsEqual } from '@/simulation/verify';

interface SimulationState {
  params: SimulationParams;
  prevParams: SimulationParams;
  result: SimulationResult;
  fullResult: SimulationResult;
  consistent: boolean;
  fingerprint: string;
  activeScenarioId: string | null;
  setParams: (mutate: (draft: SimulationParams) => void, scenarioId?: string | null) => void;
  applyScenario: (index: number) => void;
  reset: () => void;
}

function evaluate(
  prevParams: SimulationParams,
  prevResult: SimulationResult,
  nextParams: SimulationParams,
) {
  const result = runIncremental(prevParams, prevResult, nextParams);
  const fullResult = runFull(nextParams);
  return {
    result,
    fullResult,
    consistent: resultsEqual(result, fullResult),
    fingerprint: resultFingerprint(fullResult),
  };
}

function initialState() {
  const params = baseParams();
  const fullResult = runFull(params);
  return {
    params,
    prevParams: params,
    result: fullResult,
    fullResult,
    consistent: true,
    fingerprint: resultFingerprint(fullResult),
  };
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  ...initialState(),
  activeScenarioId: null,

  setParams: (mutate, scenarioId = null) => {
    const { params, prevParams, result } = get();
    const draft = structuredClone(params);
    mutate(draft);
    const evaluated = evaluate(prevParams, result, draft);
    set({
      params: draft,
      prevParams: draft,
      activeScenarioId: scenarioId,
      ...evaluated,
    });
  },

  applyScenario: (index) => {
    const scenario = scenarios()[index];
    if (!scenario) return;
    const { prevParams, result } = get();
    const draft = scenario.patch(prevParams);
    const evaluated = evaluate(prevParams, result, draft);
    set({ params: draft, prevParams: draft, activeScenarioId: scenario.id, ...evaluated });
  },

  reset: () => {
    set({ ...initialState(), activeScenarioId: null });
  },
}));
