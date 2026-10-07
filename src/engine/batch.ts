// ---------------------------------------------------------------------------
// 统一批量入口：对多组事件流 + 档位配置一次性验证并核对结论自洽性
// 校验项：事件守恒、窗口连续有序、决策引用有效、结论与决策一致、
//         增量重推结论与整体重推完全一致
// ---------------------------------------------------------------------------

import { derive, deriveState, resultsEqual } from './incremental.ts';
import { normalizeScenario } from './validate.ts';
import type { ActionSpec, DeriveResult, DeriveState, Scenario, StreamEvent } from './types.ts';

export type MutationSpec =
  | { type: 'setTierThreshold'; tierId: string; upThreshold?: number; downThreshold?: number }
  | { type: 'setTierRate'; tierId: string; rate: number }
  | { type: 'setTierAction'; tierId: string; action: ActionSpec }
  | { type: 'addAdjudication'; source: string; tick: number; chosenTierId: string; reason?: string }
  | { type: 'scaleSourceEvents'; source: string; factor: number }
  | { type: 'setBlockSize'; blockSize: number }
  | { type: 'setHorizon'; horizon: number }
  | { type: 'insertEvents'; events: StreamEvent[] };

export interface BatchCase {
  id: string;
  scenario: Scenario;
  mutations?: { description: string; spec: MutationSpec }[];
  /** 期望值断言（精确核对结论） */
  expect?: {
    dropped?: number;
    consumed?: number;
    kept?: number;
    switches?: number;
    conflictSwitches?: number;
    issueCodes?: string[];
  };
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface MutationReport {
  description: string;
  ok: boolean;
  detail: string;
  incremental?: { reusedBlocks: number; recomputedBlocks: number; affectedSources: string[]; affectedFromTick: number | null };
}

export interface CaseReport {
  caseId: string;
  ok: boolean;
  stats: { sources: number; events: number; switches: number; dropped: number; consumed: number; kept: number };
  issues: { code: string; count: number }[];
  checks: CheckResult[];
  mutations: MutationReport[];
}

export interface BatchReport {
  ok: boolean;
  totalCases: number;
  totalMutations: number;
  cases: CaseReport[];
}

export function applyMutation(scenario: Scenario, spec: MutationSpec): Scenario {
  const cloned: Scenario = JSON.parse(JSON.stringify(scenario));
  const tiers = cloned.config.tiers;
  switch (spec.type) {
    case 'setTierThreshold': {
      const tier = tiers.find((t) => t.id === spec.tierId);
      if (tier) {
        if (spec.upThreshold !== undefined) tier.upThreshold = spec.upThreshold;
        if (spec.downThreshold !== undefined) tier.downThreshold = spec.downThreshold;
      }
      break;
    }
    case 'setTierRate': {
      const tier = tiers.find((t) => t.id === spec.tierId);
      if (tier) tier.rate = spec.rate;
      break;
    }
    case 'setTierAction': {
      const tier = tiers.find((t) => t.id === spec.tierId);
      if (tier) tier.action = spec.action;
      break;
    }
    case 'addAdjudication': {
      cloned.config.adjudications = [
        ...(cloned.config.adjudications ?? []),
        {
          source: spec.source,
          tick: spec.tick,
          chosenTierId: spec.chosenTierId,
          reason: spec.reason,
        },
      ];
      break;
    }
    case 'scaleSourceEvents': {
      cloned.events = cloned.events.map((event) =>
        event.source === spec.source
          ? { ...event, tick: Math.floor(event.tick / spec.factor) }
          : event,
      );
      break;
    }
    case 'setBlockSize':
      cloned.config.blockSize = spec.blockSize;
      break;
    case 'setHorizon':
      cloned.config.horizon = spec.horizon;
      break;
    case 'insertEvents':
      cloned.events = [...cloned.events, ...spec.events];
      break;
  }
  return cloned;
}

function checkConservation(scenario: Scenario, result: DeriveResult): CheckResult {
  const normalized = normalizeScenario(scenario);
  const expectedTotal = normalized.events.length;
  let sumStats = 0;
  for (const sourceResult of Object.values(result.sources)) {
    sumStats += sourceResult.stats.total;
    const s = sourceResult.stats;
    if (s.total !== s.kept + s.dropped + s.consumed) {
      return {
        name: '事件守恒',
        ok: false,
        detail: `来源 ${sourceResult.source} 总数 ${s.total} ≠ 保留${s.kept}+丢弃${s.dropped}+消费${s.consumed}`,
      };
    }
  }
  return {
    name: '事件守恒',
    ok: sumStats === expectedTotal,
    detail: sumStats === expectedTotal
      ? `${sumStats} 条事件，保留/丢弃/消费分类完整`
      : `推导事件数 ${sumStats} ≠ 规范化后输入 ${expectedTotal}`,
  };
}

function checkSwitchWindows(result: DeriveResult): CheckResult {
  for (const sourceResult of Object.values(result.sources)) {
    const switches = sourceResult.switches;
    for (let i = 0; i < switches.length; i += 1) {
      const sw = switches[i];
      if (sw.affectedFrom !== sw.tick) {
        return { name: '切换窗口有序', ok: false, detail: `${sw.id} 区间起点 ${sw.affectedFrom} ≠ 生效时刻 ${sw.tick}` };
      }
      if (sw.affectedTo < sw.affectedFrom) {
        return { name: '切换窗口有序', ok: false, detail: `${sw.id} 区间终点早于起点` };
      }
      if (i > 0 && switches[i - 1].affectedTo + 1 !== sw.affectedFrom) {
        return {
          name: '切换窗口有序',
          ok: false,
          detail: `${sw.id} 与前一窗口 ${switches[i - 1].id} 不连续/重叠`,
        };
      }
    }
  }
  return { name: '切换窗口有序', ok: true, detail: '各来源切换窗口按时间连续且不重叠' };
}

function checkDecisionReferences(result: DeriveResult): CheckResult {
  for (const sourceResult of Object.values(result.sources)) {
    const known = new Set(sourceResult.switches.map((s) => s.id));
    for (const eventResult of sourceResult.events) {
      for (const decision of eventResult.decisions) {
        const isInitial = decision.switchId === `${sourceResult.source}#0`;
        if (!isInitial && !known.has(decision.switchId)) {
          return {
            name: '决策引用有效',
            ok: false,
            detail: `事件 ${eventResult.id} 引用了不存在的切换 ${decision.switchId}`,
          };
        }
      }
      if (eventResult.disposition === 'dropped') {
        const last = eventResult.decisions[eventResult.decisions.length - 1];
        if (!last || (last.action !== 'drop' && last.action !== 'downsample')) {
          return {
            name: '结论与决策一致',
            ok: false,
            detail: `事件 ${eventResult.id} 结论为丢弃，但无对应丢弃/降采样决策`,
          };
        }
      }
    }
  }
  return { name: '决策引用有效', ok: true, detail: '所有决策均引用存在的档位切换，结论与决策链一致' };
}

export function runCase(caseSpec: BatchCase): { report: CaseReport; state: DeriveState } {
  const fullState = deriveState(caseSpec.scenario);
  const result = fullState.result;
  const checks = [
    checkConservation(caseSpec.scenario, result),
    checkSwitchWindows(result),
    checkDecisionReferences(result),
  ];

  if (caseSpec.expect) {
    const expect = caseSpec.expect;
    const totals = { dropped: 0, consumed: 0, kept: 0 };
    for (const sourceResult of Object.values(result.sources)) {
      totals.dropped += sourceResult.stats.dropped;
      totals.consumed += sourceResult.stats.consumed;
      totals.kept += sourceResult.stats.kept;
    }
    const failures: string[] = [];
    for (const key of ['dropped', 'consumed', 'kept'] as const) {
      if (expect[key] !== undefined && totals[key] !== expect[key]) {
        failures.push(`${key} 期望 ${expect[key]} 实际 ${totals[key]}`);
      }
    }
    if (expect.switches !== undefined && result.switches.length !== expect.switches) {
      failures.push(`switches 期望 ${expect.switches} 实际 ${result.switches.length}`);
    }
    if (expect.conflictSwitches !== undefined) {
      const conflicts = result.switches.filter((s) => s.conflict).length;
      if (conflicts !== expect.conflictSwitches) {
        failures.push(`conflictSwitches 期望 ${expect.conflictSwitches} 实际 ${conflicts}`);
      }
    }
    for (const code of expect.issueCodes ?? []) {
      if (!result.issues.some((issue) => issue.code === code)) {
        failures.push(`缺少预期 issue ${code}`);
      }
    }
    checks.push({
      name: '期望断言',
      ok: failures.length === 0,
      detail: failures.length === 0 ? '所有期望值断言通过' : failures.join('；'),
    });
  }

  const mutationReports: MutationReport[] = [];
  for (const mutation of caseSpec.mutations ?? []) {
    const mutated = applyMutation(caseSpec.scenario, mutation.spec);
    // 每个 mutation 都从原始场景的推导状态出发，验证增量路径与整体重推一致
    const incState = deriveState(mutated, fullState);
    const fullMutatedResult = derive(mutated);
    const equal = resultsEqual(incState.result, fullMutatedResult);
    mutationReports.push({
      description: mutation.description,
      ok: equal,
      detail: equal ? '增量重推与整体重推结论完全一致' : '增量重推与整体重推结论不一致',
      incremental: incState.result.incremental,
    });
  }

  const issueCounts = new Map<string, number>();
  for (const issue of result.issues) {
    issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
  }
  let dropped = 0;
  let consumed = 0;
  let kept = 0;
  for (const sourceResult of Object.values(result.sources)) {
    dropped += sourceResult.stats.dropped;
    consumed += sourceResult.stats.consumed;
    kept += sourceResult.stats.kept;
  }

  const report: CaseReport = {
    caseId: caseSpec.id,
    ok: checks.every((c) => c.ok) && mutationReports.every((m) => m.ok),
    stats: {
      sources: Object.keys(result.sources).length,
      events: dropped + consumed + kept,
      switches: result.switches.length,
      dropped,
      consumed,
      kept,
    },
    issues: [...issueCounts.entries()].map(([code, count]) => ({ code, count })),
    checks,
    mutations: mutationReports,
  };
  return { report, state: fullState };
}

export function runBatch(cases: BatchCase[]): BatchReport {
  const caseReports: CaseReport[] = [];
  for (const caseSpec of cases) {
    caseReports.push(runCase(caseSpec).report);
  }
  return {
    ok: caseReports.every((c) => c.ok),
    totalCases: cases.length,
    totalMutations: cases.reduce((n, c) => n + (c.mutations?.length ?? 0), 0),
    cases: caseReports,
  };
}
