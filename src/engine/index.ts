import { normalizeEvents, rescaleSource } from "./normalize";
import { validateConfig } from "./validate";
import { runSimulation, SimOutput } from "./simulate";
import { rederive, ChangeHint } from "./incremental";
import { checkInvariants, verifyEquivalence, CheckReport } from "./verify";
import {
  Adjudication,
  BatchCase,
  CaseMutation,
  NormEvent,
  SimConfig,
  StreamEvent,
} from "./types";

export * from "./types";
export { normalizeEvents, rescaleSource } from "./normalize";
export { validateConfig, resolveTiers } from "./validate";
export { runSimulation } from "./simulate";
export type { SimOutput, Snapshot } from "./simulate";
export { rederive, impactStart, selectSnapshot } from "./incremental";
export type { ChangeHint } from "./incremental";
export { checkInvariants, verifyEquivalence } from "./verify";
export type { CheckReport } from "./verify";

export interface RunOutcome {
  output: SimOutput | null;
  blockingIssues: string[];
  allIssues: string[];
}

/**
 * 统一推演入口：规范化 → 校验 → 仿真。
 * 存在阻塞性配置问题（未裁决的重叠/成环等）时拒绝推演并显式返回原因。
 */
export function runCase(
  rawEvents: StreamEvent[],
  config: SimConfig,
  adjudications: Adjudication[] = [],
): RunOutcome {
  const { events, issues } = normalizeEvents(rawEvents);
  const configIssues = validateConfig(config, adjudications);
  const blocking = configIssues.filter((c) => c.blocking);
  const allIssues = [
    ...issues.map((i) => `[数据] ${i.message}`),
    ...configIssues.map((c) => `[配置] ${c.message}`),
  ];
  if (blocking.length > 0) {
    return {
      output: null,
      blockingIssues: blocking.map((c) => c.message),
      allIssues,
    };
  }
  const output = runSimulation(events, config, adjudications);
  output.issues = issues;
  output.configIssues = configIssues;
  return { output, blockingIssues: [], allIssues };
}

export interface MutationResult {
  name: string;
  incremental: SimOutput;
  full: SimOutput;
  report: CheckReport;
  resumedFromSnapshot: boolean;
  impactStart: number;
}

/**
 * 应用单条变更并验证：增量重推 vs 整体重推必须一致。
 */
export function applyMutation(
  prev: SimOutput,
  normEvents: NormEvent[],
  config: SimConfig,
  mutation: CaseMutation,
  adjudications: Adjudication[] = [],
): MutationResult {
  let nextEvents = normEvents;
  let nextConfig = config;
  let nextAdj = adjudications;
  let hint: ChangeHint;
  let name: string;

  switch (mutation.kind) {
    case "sourceRate":
      nextEvents = rescaleSource(normEvents, mutation.sourceId, mutation.factor);
      hint = { kind: "sourceRate", sourceId: mutation.sourceId };
      name = `来源 ${mutation.sourceId} 速率 ×${mutation.factor}`;
      break;
    case "tierThreshold":
      nextConfig = {
        ...config,
        tiers: config.tiers.map((t) =>
          t.id === mutation.tierId ? { ...t, threshold: mutation.threshold } : t,
        ),
      };
      hint = { kind: "tierThreshold", tierId: mutation.tierId, newThreshold: mutation.threshold };
      name = `档位 ${mutation.tierId} 阈值 → ${mutation.threshold}`;
      break;
    case "tierRate":
      nextConfig = {
        ...config,
        tiers: config.tiers.map((t) =>
          t.id === mutation.tierId ? { ...t, consumeRate: mutation.consumeRate } : t,
        ),
      };
      hint = { kind: "tierRate", tierId: mutation.tierId };
      name = `档位 ${mutation.tierId} 消费速率 → ${mutation.consumeRate}`;
      break;
    case "adjudicate":
      nextAdj = [...adjudications, mutation.adjudication];
      hint = { kind: "adjudicate" };
      name = `人工裁决 ${mutation.adjudication.id}`;
      break;
  }

  const { output: incremental, resumedFrom, start } = rederive(
    prev,
    nextEvents,
    nextConfig,
    hint,
    nextAdj,
  );
  const full = runSimulation(nextEvents, nextConfig, nextAdj);
  full.issues = prev.issues;
  const report = verifyEquivalence(incremental, full);
  return {
    name,
    incremental,
    full,
    report,
    resumedFromSnapshot: resumedFrom !== null,
    impactStart: start,
  };
}

export interface BatchReport {
  caseName: string;
  ok: boolean;
  blockingIssues: string[];
  invariantReport?: CheckReport;
  mutations: { name: string; ok: boolean; failures: string[]; resumedFromSnapshot: boolean }[];
  stats?: SimOutput["stats"];
}

/**
 * 统一批量入口：对一组 {事件流, 档位配置, 变更脚本} 依次
 * 运行推演 → 不变量检查 → 逐条变更的增量/全量一致性核对。
 */
export function runBatch(cases: BatchCase[]): BatchReport[] {
  return cases.map((c) => {
    const adjudications = c.adjudications ?? [];
    const outcome = runCase(c.events, c.config, adjudications);
    if (!outcome.output) {
      return {
        caseName: c.name,
        ok: outcome.blockingIssues.length === 0,
        blockingIssues: outcome.blockingIssues,
        mutations: [],
      };
    }
    const invariantReport = checkInvariants(outcome.output);
    const mutations: BatchReport["mutations"] = [];
    let current = outcome.output;
    let currentEvents = current.normEvents;
    let currentConfig = c.config;
    let currentAdj = adjudications;
    for (const m of c.mutations ?? []) {
      const r = applyMutation(current, currentEvents, currentConfig, m, currentAdj);
      mutations.push({
        name: r.name,
        ok: r.report.ok,
        failures: r.report.failures,
        resumedFromSnapshot: r.resumedFromSnapshot,
      });
      current = r.full;
      currentEvents = r.full.normEvents;
      currentAdj =
        m.kind === "adjudicate" ? [...currentAdj, m.adjudication] : currentAdj;
      currentConfig =
        m.kind === "tierThreshold"
          ? { ...currentConfig, tiers: currentConfig.tiers.map((t) => t.id === m.tierId ? { ...t, threshold: m.threshold } : t) }
          : m.kind === "tierRate"
            ? { ...currentConfig, tiers: currentConfig.tiers.map((t) => t.id === m.tierId ? { ...t, consumeRate: m.consumeRate } : t) }
            : currentConfig;
    }
    const ok =
      invariantReport.ok && mutations.every((m) => m.ok);
    return {
      caseName: c.name,
      ok,
      blockingIssues: [],
      invariantReport,
      mutations,
      stats: current.stats,
    };
  });
}
