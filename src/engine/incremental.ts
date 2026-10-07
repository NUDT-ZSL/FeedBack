// ---------------------------------------------------------------------------
// 增量推导：分块独立重算 + 边界进位拼接
// 复用条件（sound）：prevBlock.inputHash === inputHash 且 carryIn 深度相等。
// inputHash 覆盖：全局配置 + 来源 + 块内事件 + 与本块相关的裁决，
// 因此“输入相同 + 进位相同 => 输出相同”严格成立。
// 变更影响面：
//  - 来源事件/速率变化 -> 仅该来源，从首个受影响块起，收敛后自动复用后缀
//  - 档位配置变化 -> 影响所有来源（档位为全局语义），全量重推并报告影响面
//  - 人工裁决 -> 仅该来源、自裁决生效块起
// ---------------------------------------------------------------------------

import { cloneCarry, initialCarry, simulateRange, type SimContext } from './simulate.ts';
import type {
  BlockOutput,
  CarryState,
  DeriveResult,
  DeriveState,
  EventResult,
  ManualAdjudication,
  Scenario,
  SourceBlocks,
  SourceResult,
  SwitchRecord,
  ValidationIssue,
} from './types.ts';
import { analyzeSwitchEdges, normalizeScenario, type NormalizedScenario } from './validate.ts';

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function hashJson(value: unknown): string {
  return fnv1a(JSON.stringify(value));
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface SourcePlan {
  source: string;
  events: { id: string; tick: number; seq: number; source: string; payload?: unknown }[];
}

function buildContext(
  normalized: NormalizedScenario,
  source: string,
  adjudications: Map<string, ManualAdjudication>,
  issues: ValidationIssue[],
): SimContext {
  const tierById = new Map(normalized.tiers.map((t) => [t.id, t]));
  const { allowed } = analyzeSwitchEdges(normalized.tiers);
  const sourceCfg = (normalized.config.sources ?? []).find((s) => s.id === source);
  return {
    tiers: normalized.tiers,
    tierById,
    baseTier: normalized.baseTier,
    horizon: normalized.horizon,
    allowed,
    adjudications,
    baseCapacity: sourceCfg?.baseCapacity ?? Infinity,
    issues,
  };
}

function adjudicationKey(source: string, tick: number): string {
  return `${source}@${tick}`;
}

function mergeBlocks(
  source: string,
  blocks: BlockOutput[],
  horizon: number,
): SourceResult {
  const samples = blocks.flatMap((b) => b.samples);
  const switches: SwitchRecord[] = blocks.flatMap((b) => b.switches);
  const lastCarry = blocks.length ? blocks[blocks.length - 1].carryOut : null;
  if (lastCarry?.openSwitch) {
    // 克隆以避免污染被复用块的状态
    switches.push({
      ...lastCarry.openSwitch,
      affectedTo: horizon,
      affectedEventCount: lastCarry.windowAffected,
    });
  }

  const eventMap = new Map<string, EventResult>();
  for (const block of blocks) {
    for (const eventResult of block.eventResults) {
      const existing = eventMap.get(eventResult.id);
      if (!existing) {
        eventMap.set(eventResult.id, { ...eventResult, decisions: [...eventResult.decisions] });
      } else {
        existing.decisions.push(...eventResult.decisions);
        existing.disposition = eventResult.disposition;
      }
    }
  }
  const events = [...eventMap.values()].sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  for (const eventResult of events) {
    eventResult.decisions.sort((a, b) => a.tick - b.tick);
    if (eventResult.disposition === 'consumed') {
      eventResult.effectiveSwitchId = undefined;
    } else {
      const last = eventResult.decisions[eventResult.decisions.length - 1];
      eventResult.effectiveSwitchId = last?.switchId;
    }
  }

  const stats = { total: events.length, kept: 0, dropped: 0, consumed: 0, pending: 0 };
  for (const eventResult of events) {
    stats[eventResult.disposition] += 1;
  }
  stats.pending = stats.kept;

  return { source, samples, switches, events, stats };
}

function runSource(
  normalized: NormalizedScenario,
  plan: SourcePlan,
  prevBlocks: BlockOutput[] | null,
  configHash: string,
  adjudications: Map<string, ManualAdjudication>,
  issues: ValidationIssue[],
): { blocks: BlockOutput[]; reused: number; recomputed: number; firstRecomputedTick: number | null } {
  const { blockSize, horizon } = normalized;
  const ctx = buildContext(normalized, plan.source, adjudications, issues);
  const blockCount = Math.max(1, Math.ceil((horizon + 1) / blockSize));
  const blocks: BlockOutput[] = [];
  let carry: CarryState = initialCarry(ctx, 0);
  let reused = 0;
  let recomputed = 0;
  let firstRecomputedTick: number | null = null;
  let eventIndex = 0;

  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const startTick = blockIndex * blockSize;
    const endTick = Math.min((blockIndex + 1) * blockSize, horizon + 1);
    const blockEvents = [];
    while (eventIndex < plan.events.length && plan.events[eventIndex].tick < endTick) {
      blockEvents.push(plan.events[eventIndex]);
      eventIndex += 1;
    }
    // 与本块相关的裁决：switchTick - 1 落在块内（评估发生于 tick t 结束，生效于 t+1）
    const blockAdjudications = (normalized.config.adjudications ?? []).filter(
      (a) => a.source === plan.source && a.tick - 1 >= startTick && a.tick - 1 < endTick,
    );
    const inputHash = hashJson({
      configHash,
      source: plan.source,
      events: blockEvents.map((e) => [e.id, e.tick]),
      adjudications: blockAdjudications,
    });

    const prevBlock = prevBlocks?.[blockIndex];
    if (prevBlock && prevBlock.inputHash === inputHash && jsonEqual(prevBlock.carryIn, carry)) {
      blocks.push(prevBlock);
      carry = cloneCarry(prevBlock.carryOut);
      reused += 1;
      continue;
    }

    const output = simulateRange(
      ctx,
      plan.source,
      blockEvents as never,
      carry,
      startTick,
      endTick,
    );
    output.inputHash = inputHash;
    blocks.push(output);
    carry = output.carryOut;
    recomputed += 1;
    if (firstRecomputedTick === null) firstRecomputedTick = startTick;
  }
  return { blocks, reused, recomputed, firstRecomputedTick };
}

/** 推导（传 prev 时自动增量；不传为全量）。返回完整状态供下次增量复用。 */
export function deriveState(scenario: Scenario, prev?: DeriveState): DeriveState {
  const normalized = normalizeScenario(scenario);
  const issues: ValidationIssue[] = [...normalized.issues];
  const configHash = hashJson({
    tiers: normalized.tiers,
    sources: normalized.config.sources ?? [],
    horizon: normalized.horizon,
    blockSize: normalized.blockSize,
  });

  const prevUsable =
    prev && prev.blockSize === normalized.blockSize && prev.horizon === normalized.horizon
      ? prev
      : undefined;

  const sources: Record<string, SourceBlocks> = {};
  const resultSources: Record<string, SourceResult> = {};
  const allSwitches: SwitchRecord[] = [];
  let reusedBlocks = 0;
  let recomputedBlocks = 0;
  const affectedSources: string[] = [];
  let affectedFromTick: number | null = null;

  const sourceNames = new Set<string>([
    ...normalized.eventsBySource.keys(),
    ...(prevUsable ? Object.keys(prevUsable.sources) : []),
  ]);

  for (const source of [...sourceNames].sort()) {
    const events = normalized.eventsBySource.get(source) ?? [];
    const sourceAdjudications = new Map<string, ManualAdjudication>();
    for (const adjudication of normalized.config.adjudications ?? []) {
      if (adjudication.source === source) {
        sourceAdjudications.set(adjudicationKey(source, adjudication.tick), adjudication);
      }
    }
    const inputHash = hashJson({
      configHash,
      source,
      events: events.map((e) => [e.id, e.tick]),
      adjudications: [...sourceAdjudications.values()],
    });

    const prevSource = prevUsable?.sources[source];
    if (prevSource && prevSource.inputHash === inputHash) {
      // 来源完全未受影响：整体复用
      sources[source] = prevSource;
      resultSources[source] = prevSource.result;
      allSwitches.push(...prevSource.result.switches);
      reusedBlocks += prevSource.blocks.length;
      continue;
    }

    if (events.length === 0) {
      if (prevSource) affectedSources.push(source);
      continue; // 来源已移除
    }

    const { blocks, reused, recomputed, firstRecomputedTick } = runSource(
      normalized,
      { source, events: events as never },
      prevSource?.blocks ?? null,
      configHash,
      sourceAdjudications,
      issues,
    );
    reusedBlocks += reused;
    recomputedBlocks += recomputed;
    if (recomputed > 0) {
      affectedSources.push(source);
      if (firstRecomputedTick !== null) {
        affectedFromTick =
          affectedFromTick === null ? firstRecomputedTick : Math.min(affectedFromTick, firstRecomputedTick);
      }
    }
    const result = mergeBlocks(source, blocks, normalized.horizon);
    const lastCarry = blocks[blocks.length - 1]?.carryOut;
    if (lastCarry && lastCarry.queued.length + lastCarry.held.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'BACKLOG_REMAINING',
        message: `时间轴结束时来源 ${source} 仍有 ${lastCarry.queued.length} 条排队、${lastCarry.held.length} 条暂停暂存事件未消费`,
        source,
      });
    }
    sources[source] = { source, inputHash, blocks, result };
    resultSources[source] = result;
    allSwitches.push(...result.switches);
  }

  allSwitches.sort((a, b) => a.tick - b.tick || a.source.localeCompare(b.source));

  const result: DeriveResult = {
    scenarioId: scenario.id,
    horizon: normalized.horizon,
    sources: resultSources,
    switches: allSwitches,
    issues,
    incremental: {
      reusedBlocks,
      recomputedBlocks,
      affectedSources,
      affectedFromTick,
    },
  };

  return {
    scenarioId: scenario.id,
    configHash,
    blockSize: normalized.blockSize,
    horizon: normalized.horizon,
    sources,
    result,
  };
}

/** 全量推导 */
export function derive(scenario: Scenario): DeriveResult {
  return deriveState(scenario).result;
}

/** 比较两次推导结论是否一致（忽略增量元信息） */
export function resultsEqual(a: DeriveResult, b: DeriveResult): boolean {
  const strip = (r: DeriveResult) => ({
    scenarioId: r.scenarioId,
    horizon: r.horizon,
    sources: r.sources,
    switches: r.switches,
    issues: r.issues,
  });
  return jsonEqual(strip(a), strip(b));
}
