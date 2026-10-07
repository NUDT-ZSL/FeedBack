// ---------------------------------------------------------------------------
// 输入校验与规范化
// 原则：任何异常输入都产生显式 ValidationIssue，绝不静默跳过或随意择一。
// ---------------------------------------------------------------------------

import {
  MAX_TICKS,
  UNKNOWN_SOURCE,
  type ActionSpec,
  type Scenario,
  type StreamEvent,
  type TierConfig,
  type ValidationIssue,
} from './types.ts';

export interface NormalizedEvent extends StreamEvent {
  /** 原始输入序号，用于同刻事件的稳定排序 */
  seq: number;
}

export interface NormalizedScenario {
  id: string;
  /** 按 (tick, seq) 稳定排序后的事件 */
  events: NormalizedEvent[];
  /** 按来源分组的事件（保持排序） */
  eventsBySource: Map<string, NormalizedEvent[]>;
  tiers: TierConfig[];
  /** 基准档位（upThreshold === 0，按优先级最高者） */
  baseTier: TierConfig;
  horizon: number;
  blockSize: number;
  issues: ValidationIssue[];
  config: Scenario['config'];
}

/** 档位优先级：upThreshold 高者优先；并列时配置数组中靠前者优先 */
export function tierPriority(tiers: TierConfig[]): Map<string, number> {
  const order = new Map<string, number>();
  const indexed = tiers.map((t, i) => ({ t, i }));
  indexed.sort((a, b) => b.t.upThreshold - a.t.upThreshold || a.i - b.i);
  indexed.forEach(({ t }, rank) => order.set(t.id, rank));
  return order;
}

export function effectiveDownThreshold(tier: TierConfig): number {
  return tier.downThreshold ?? tier.upThreshold;
}

/** 显式切换边成环检测（SCC），返回被禁用的边及 issue */
export function analyzeSwitchEdges(tiers: TierConfig[]): {
  allowed: Map<string, Set<string> | null>;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const ids = new Set(tiers.map((t) => t.id));
  const allowed = new Map<string, Set<string> | null>();
  const priority = tierPriority(tiers);

  for (const tier of tiers) {
    if (!tier.allowedNext || tier.allowedNext.length === 0) {
      allowed.set(tier.id, null); // null = 默认阶梯邻接（可切往任意可选档位）
      continue;
    }
    const targets = new Set<string>();
    for (const target of tier.allowedNext) {
      if (!ids.has(target)) {
        issues.push({
          severity: 'error',
          code: 'TIER_EDGE_UNKNOWN_TARGET',
          message: `档位 ${tier.id} 的切换目标 ${target} 不存在，该边被忽略`,
          tierId: tier.id,
        });
        continue;
      }
      targets.add(target);
    }
    allowed.set(tier.id, targets);
  }

  // 在显式边图上做 SCC 检测；非平凡 SCC 视为成环
  const explicit = new Map<string, string[]>();
  for (const tier of tiers) {
    const set = allowed.get(tier.id);
    if (set) explicit.set(tier.id, [...set]);
  }
  const sccs = stronglyConnectedComponents(explicit);
  for (const scc of sccs) {
    if (scc.length < 2) continue;
    // 破环规则（确定性）：SCC 内仅保留指向更高优先级档位的边，其余禁用
    for (const from of scc) {
      const set = allowed.get(from);
      if (!set) continue;
      for (const to of [...set]) {
        if (!scc.includes(to)) continue;
        if ((priority.get(to) ?? 0) >= (priority.get(from) ?? 0)) {
          set.delete(to);
          issues.push({
            severity: 'error',
            code: 'TIER_EDGE_CYCLE',
            message: `检测到切换环 [${scc.join(' -> ')}]，已禁用边 ${from} -> ${to}（保留指向更高优先级档位的边）`,
            tierId: from,
          });
        }
      }
    }
  }
  return { allowed, issues };
}

function stronglyConnectedComponents(graph: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const scc: string[] = [];
      let popped: string | undefined;
      do {
        popped = stack.pop();
        if (popped !== undefined) {
          onStack.delete(popped);
          scc.push(popped);
        }
      } while (popped !== node);
      result.push(scc);
    }
  };
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return result;
}

export function validateAction(tier: TierConfig, action: ActionSpec, issues: ValidationIssue[]): void {
  const fail = (message: string) =>
    issues.push({ severity: 'error', code: 'TIER_ACTION_INVALID', message, tierId: tier.id });
  switch (action.kind) {
    case 'drop':
      if (!(action.dropRatio !== undefined && action.dropRatio > 0 && action.dropRatio <= 1))
        fail(`档位 ${tier.id} 的 drop 动作需要 0 < dropRatio <= 1`);
      break;
    case 'downsample':
      if (!(Number.isInteger(action.keepEvery) && (action.keepEvery ?? 0) >= 2))
        fail(`档位 ${tier.id} 的 downsample 动作需要整数 keepEvery >= 2`);
      break;
    case 'expand':
      if (!(Number.isInteger(action.expandBy) && (action.expandBy ?? 0) > 0))
        fail(`档位 ${tier.id} 的 expand 动作需要整数 expandBy > 0`);
      break;
    case 'pause':
      if (!(Number.isInteger(action.pauseTicks) && (action.pauseTicks ?? 0) > 0))
        fail(`档位 ${tier.id} 的 pause 动作需要整数 pauseTicks > 0`);
      break;
  }
}

export function normalizeScenario(scenario: Scenario): NormalizedScenario {
  const issues: ValidationIssue[] = [];
  const config = scenario.config;

  // --- 事件规范化 ---
  const seenIds = new Set<string>();
  const events: NormalizedEvent[] = [];
  scenario.events.forEach((event, seq) => {
    let { source, tick } = event;
    if (source === undefined || source === null || source === '') {
      issues.push({
        severity: 'warning',
        code: 'EVENT_MISSING_SOURCE',
        message: `事件 ${event.id} 缺少来源标识，归入保留来源 ${UNKNOWN_SOURCE}`,
        eventId: event.id,
      });
      source = UNKNOWN_SOURCE;
    }
    if (seenIds.has(event.id)) {
      issues.push({
        severity: 'error',
        code: 'EVENT_DUPLICATE_ID',
        message: `事件 id ${event.id} 重复，后者被排除`,
        source,
        eventId: event.id,
      });
      return;
    }
    seenIds.add(event.id);
    if (!Number.isInteger(tick)) {
      issues.push({
        severity: 'warning',
        code: 'EVENT_NON_INTEGER_TICK',
        message: `事件 ${event.id} 到达时刻 ${tick} 非整数，已向下取整为 ${Math.floor(tick)}`,
        source,
        eventId: event.id,
      });
      tick = Math.floor(tick);
    }
    if (tick < 0) {
      issues.push({
        severity: 'error',
        code: 'EVENT_NEGATIVE_TICK',
        message: `事件 ${event.id} 到达时刻为负，已排除`,
        source,
        eventId: event.id,
      });
      return;
    }
    events.push({ ...event, source, tick, seq });
  });
  // 乱序到达：按 (tick, 原始序号) 稳定排序，同刻多条按输入顺序处理
  events.sort((a, b) => a.tick - b.tick || a.seq - b.seq);

  const eventsBySource = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    const list = eventsBySource.get(event.source) ?? [];
    list.push(event);
    eventsBySource.set(event.source, list);
  }

  // --- 档位规范化 ---
  const tiers = config.tiers ?? [];
  const tierIds = new Set<string>();
  for (const tier of tiers) {
    if (tierIds.has(tier.id)) {
      issues.push({
        severity: 'error',
        code: 'TIER_DUPLICATE_ID',
        message: `档位 id ${tier.id} 重复，后者被忽略`,
        tierId: tier.id,
      });
      continue;
    }
    tierIds.add(tier.id);
    if (!(tier.rate >= 0)) {
      issues.push({
        severity: 'error',
        code: 'TIER_INVALID_RATE',
        message: `档位 ${tier.id} 消费速率非法，按 0 处理`,
        tierId: tier.id,
      });
      tier.rate = 0;
    }
    if (!(tier.upThreshold >= 0)) {
      issues.push({
        severity: 'error',
        code: 'TIER_INVALID_THRESHOLD',
        message: `档位 ${tier.id} 阈值非法，按 0 处理`,
        tierId: tier.id,
      });
      tier.upThreshold = 0;
    }
    if (tier.downThreshold !== undefined && tier.downThreshold > tier.upThreshold) {
      issues.push({
        severity: 'error',
        code: 'TIER_INVALID_THRESHOLD',
        message: `档位 ${tier.id} 下阈值高于上阈值，下阈值按上阈值处理`,
        tierId: tier.id,
      });
      tier.downThreshold = tier.upThreshold;
    }
    if (tier.action) validateAction(tier, tier.action, issues);
  }
  const validTiers = tiers.filter((t) => tierIds.has(t.id));

  // 阈值重叠：upThreshold 相同（含基准档）-> 显式记录；档位全部保留，
  // 运行期多档并列时会把该次判定标为 conflict，默认按配置顺序择一并可人工裁决
  const byThreshold = new Map<number, TierConfig[]>();
  for (const tier of validTiers) {
    const list = byThreshold.get(tier.upThreshold) ?? [];
    list.push(tier);
    byThreshold.set(tier.upThreshold, list);
  }
  const keptTiers: TierConfig[] = [...validTiers];
  for (const [threshold, group] of byThreshold) {
    if (group.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'TIER_THRESHOLD_OVERLAP',
        message: `阈值 ${threshold} 被多个档位使用（${group
          .map((g) => g.id)
          .join(', ')}）；当它们同时满足触发条件时，该次档位判定将标记为冲突，默认按配置顺序择一（${group[0].id}），可在冲突记录中逐次人工裁决`,
        tierId: group[0].id,
      });
    }
  }

  const baseCandidates = keptTiers.filter((t) => t.upThreshold === 0);
  if (baseCandidates.length === 0) {
    issues.push({
      severity: 'error',
      code: 'TIER_NO_BASE',
      message: '缺少 upThreshold 为 0 的基准档位，已自动补充 normal(rate=0)',
    });
    keptTiers.push({ id: 'normal', rate: 0, upThreshold: 0 });
  }
  const finalPriority = tierPriority(keptTiers);
  const baseTier = [...keptTiers]
    .filter((t) => t.upThreshold === 0)
    .sort((a, b) => (finalPriority.get(a.id) ?? 0) - (finalPriority.get(b.id) ?? 0))[0];

  // --- 时间轴 ---
  const maxEventTick = events.length ? events[events.length - 1].tick : 0;
  const maxPause = Math.max(
    0,
    ...keptTiers.map((t) => (t.action?.kind === 'pause' ? t.action.pauseTicks ?? 0 : 0)),
  );
  let horizon = config.horizon ?? maxEventTick + maxPause + 1;
  if (horizon > MAX_TICKS) {
    issues.push({
      severity: 'warning',
      code: 'HORIZON_TRUNCATED',
      message: `时间轴上限 ${horizon} 超过 MAX_TICKS=${MAX_TICKS}，已截断`,
    });
    horizon = MAX_TICKS;
  }
  for (const event of events) {
    if (event.tick > horizon) {
      issues.push({
        severity: 'error',
        code: 'EVENT_BEYOND_HORIZON',
        message: `事件 ${event.id} 到达时刻 ${event.tick} 超出时间轴 ${horizon}，已排除`,
        source: event.source,
        eventId: event.id,
        tick: event.tick,
      });
    }
  }
  const inHorizon = events.filter((e) => e.tick <= horizon);
  const inHorizonBySource = new Map<string, NormalizedEvent[]>();
  for (const event of inHorizon) {
    const list = inHorizonBySource.get(event.source) ?? [];
    list.push(event);
    inHorizonBySource.set(event.source, list);
  }

  const edgeAnalysis = analyzeSwitchEdges(keptTiers);
  issues.push(...edgeAnalysis.issues);

  return {
    id: scenario.id,
    events: inHorizon,
    eventsBySource: inHorizonBySource,
    tiers: keptTiers,
    baseTier,
    horizon,
    blockSize: Math.max(1, config.blockSize ?? 64),
    issues,
    config,
  };
}
