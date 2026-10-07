// ---------------------------------------------------------------------------
// 核心模拟器：按块推进单个来源的事件流
// 每个 tick 的顺序：恢复暂停 -> 准入（容量/动作门控）-> 消费 -> 档位评估
// 档位评估在 tick t 结束时进行，切换自 tick t+1 起生效。
// ---------------------------------------------------------------------------

import type {
  ActionSpec,
  BacklogSample,
  BlockOutput,
  CarryState,
  Decision,
  EventResult,
  ManualAdjudication,
  StreamEvent,
  SwitchRecord,
  TierConfig,
  ValidationIssue,
} from './types.ts';
import { effectiveDownThreshold, tierPriority, type NormalizedEvent } from './validate.ts';

export interface SimContext {
  tiers: TierConfig[];
  tierById: Map<string, TierConfig>;
  baseTier: TierConfig;
  /** 时间轴上限 */
  horizon: number;
  /** 显式切换边（null = 默认阶梯邻接） */
  allowed: Map<string, Set<string> | null>;
  /** 人工裁决，键为 `${source}@${tick}` */
  adjudications: Map<string, ManualAdjudication>;
  /** 该来源的基础容量 */
  baseCapacity: number;
  issues: ValidationIssue[];
}

export function initialCarry(ctx: SimContext, startTick: number): CarryState {
  return {
    tick: startTick,
    queued: [],
    capacity: ctx.baseCapacity,
    tierId: ctx.baseTier.id,
    pausedUntil: -1,
    held: [],
    downsampleCounter: 0,
    dropCounter: 0,
    rateCarry: 0,
    windowStart: startTick,
    windowAffected: 0,
    switchSeq: 0,
    windowOrigin: 'auto',
    openSwitch: null,
  };
}

export function cloneCarry(carry: CarryState): CarryState {
  // structuredClone 保留 Infinity 容量等特殊值（JSON 会将其变为 null）
  return structuredClone(carry);
}

function currentSwitchId(carry: CarryState, source: string): string {
  return `${source}#${carry.switchSeq}`;
}

function touchResult(
  results: Map<string, EventResult>,
  event: StreamEvent,
): EventResult {
  let result = results.get(event.id);
  if (!result) {
    result = { id: event.id, source: event.source, tick: event.tick, disposition: 'kept', decisions: [] };
    results.set(event.id, result);
  }
  return result;
}

function recordDecision(
  results: Map<string, EventResult>,
  event: StreamEvent,
  decision: Decision,
): EventResult {
  const result = touchResult(results, event);
  result.decisions.push(decision);
  return result;
}

/** drop 门控：Bresenham 比例丢弃，窗口内确定性 */
function shouldDropByRatio(counter: number, ratio: number): boolean {
  return Math.floor(counter * ratio) > Math.floor((counter - 1) * ratio);
}

/** 准入阶段：处理暂停暂存、容量限制与档位动作门控 */
function admitEvents(
  ctx: SimContext,
  carry: CarryState,
  source: string,
  arrivals: StreamEvent[],
  tick: number,
  results: Map<string, EventResult>,
): StreamEvent[] {
  const tier = ctx.tierById.get(carry.tierId) ?? ctx.baseTier;
  const action = tier.action;
  const switchId = currentSwitchId(carry, source);
  const origin = carry.windowOrigin;
  const admitted: StreamEvent[] = [];

  // 暂停恢复：pausedUntil 到达时，暂存事件按序补入候选
  let candidates = arrivals;
  if (carry.pausedUntil >= 0 && tick < carry.pausedUntil) {
    // 仍在暂停：到达事件暂存，不进入准入
    carry.held.push(...arrivals);
    for (const event of arrivals) {
      recordDecision(results, event, {
        switchId, tierId: carry.tierId, action: 'admit', tick, origin,
        detail: `来源暂停中（至 tick ${carry.pausedUntil}），事件暂存`,
      });
    }
    carry.windowAffected += arrivals.length;
    return admitted;
  }
  if (carry.pausedUntil >= 0 && tick >= carry.pausedUntil) {
    candidates = [...carry.held, ...arrivals];
    carry.held = [];
    carry.pausedUntil = -1;
  }

  for (const event of candidates) {
    carry.windowAffected += 1;
    // 档位动作门控（作用于新到达事件）
    if (action?.kind === 'drop') {
      carry.dropCounter += 1;
      if (shouldDropByRatio(carry.dropCounter, action.dropRatio ?? 1)) {
        const r = recordDecision(results, event, {
          switchId, tierId: carry.tierId, action: 'drop', tick, origin,
          detail: `drop 动作按窗口累计比例 ${action.dropRatio} 丢弃最新到达事件`,
        });
        r.disposition = 'dropped';
        r.effectiveSwitchId = switchId;
        continue;
      }
    } else if (action?.kind === 'downsample') {
      carry.downsampleCounter += 1;
      const keepEvery = action.keepEvery ?? 1;
      if (carry.downsampleCounter % keepEvery !== 0) {
        const r = recordDecision(results, event, {
          switchId, tierId: carry.tierId, action: 'downsample', tick, origin,
          detail: `downsample 动作每 ${keepEvery} 条保留 1 条，本条被丢弃`,
        });
        r.disposition = 'dropped';
        r.effectiveSwitchId = switchId;
        continue;
      }
      recordDecision(results, event, {
        switchId, tierId: carry.tierId, action: 'downsample', tick, origin,
        detail: `downsample 动作每 ${keepEvery} 条保留 1 条，本条被保留`,
      });
    }
    // 容量准入
    if (carry.queued.length + admitted.length < carry.capacity) {
      admitted.push(event);
      // 已准入事件立即建档，保证时间轴结束时仍在队列中的事件也有结论（保留）
      touchResult(results, event);
    } else {
      const r = recordDecision(results, event, {
        switchId, tierId: carry.tierId, action: 'drop', tick, origin,
        detail: `缓冲容量 ${carry.capacity} 已满，溢出丢弃`,
      });
      r.disposition = 'dropped';
      r.effectiveSwitchId = switchId;
    }
  }
  return admitted;
}

/** 档位评估：在 tick t 结束时调用，返回自 t+1 起生效的切换（若有） */
function evaluateTier(
  ctx: SimContext,
  carry: CarryState,
  source: string,
  tick: number,
  backlog: number,
): { record: SwitchRecord; nextTier: TierConfig; origin: 'auto' | 'manual' } | null {
  const current = ctx.tierById.get(carry.tierId) ?? ctx.baseTier;

  const eligible = ctx.tiers.filter(
    (tier) =>
      backlog > tier.upThreshold ||
      tier.upThreshold === 0 ||
      (tier.id === current.id && backlog >= effectiveDownThreshold(tier)),
  );
  if (eligible.length === 0) return null;

  // 显式切换边过滤（仅约束切出目标；当前档不在集合内时也可停留，但不强制切换）
  const edgeSet = ctx.allowed.get(current.id);
  const reachable = edgeSet
    ? eligible.filter((tier) => tier.id === current.id || edgeSet.has(tier.id))
    : eligible;
  if (reachable.length === 0) return null;

  const priority = tierPriority(ctx.tiers);
  const sorted = [...reachable].sort(
    (a, b) => (priority.get(a.id) ?? 0) - (priority.get(b.id) ?? 0),
  );
  let winner = sorted[0];
  let origin: 'auto' | 'manual' = 'auto';

  // 冲突：并列最高优先级的多个候选（阈值相同）
  const topThreshold = winner.upThreshold;
  const conflictCandidates = sorted.filter((t) => t.upThreshold === topThreshold);
  const conflict = conflictCandidates.length > 1;

  const switchTick = tick + 1;
  let adjudication: SwitchRecord['adjudication'];
  if (conflict) {
    const key = `${source}@${switchTick}`;
    const manual = ctx.adjudications.get(key);
    if (manual) {
      const chosen = conflictCandidates.find((t) => t.id === manual.chosenTierId);
      if (chosen) {
        winner = chosen;
        origin = 'manual';
        adjudication = { chosenTierId: chosen.id, reason: manual.reason };
      } else {
        ctx.issues.push({
          severity: 'warning',
          code: 'ADJUDICATION_UNMATCHED',
          message: `人工裁决 ${key} 指定的档位 ${manual.chosenTierId} 不在候选集内，回退为默认判定 ${winner.id}`,
          source,
          tick: switchTick,
        });
      }
    }
  }

  if (winner.id === current.id) return null;

  const record: SwitchRecord = {
    id: `${source}#${carry.switchSeq + 1}`,
    source,
    tick: switchTick,
    fromTier: current.id,
    toTier: winner.id,
    basis: {
      backlog,
      upThreshold: winner.upThreshold,
      downThreshold: effectiveDownThreshold(winner),
      candidates: sorted.map((t) => t.id),
    },
    affectedFrom: switchTick,
    affectedTo: switchTick,
    affectedEventCount: 0,
    conflict,
    conflictCandidates: conflict ? conflictCandidates.map((t) => t.id) : undefined,
    adjudication,
  };
  return { record, nextTier: winner, origin };
}

/** 进入档位时的入场动作（expand / pause） */
function applyEntryAction(
  ctx: SimContext,
  carry: CarryState,
  tier: TierConfig,
  switchTick: number,
): void {
  const action: ActionSpec | undefined = tier.action;
  if (!action) return;
  if (action.kind === 'expand') {
    carry.capacity += action.expandBy ?? 0;
  } else if (action.kind === 'pause') {
    carry.pausedUntil = switchTick + (action.pauseTicks ?? 0);
  }
}

/**
 * 模拟 [startTick, endTick) 区间，产出块结果。
 * events 必须已按 (tick, seq) 排序且全部落在区间内。
 */
export function simulateRange(
  ctx: SimContext,
  source: string,
  events: NormalizedEvent[],
  carryIn: CarryState,
  startTick: number,
  endTick: number,
): BlockOutput {
  const carry = cloneCarry(carryIn);
  const samples: BacklogSample[] = [];
  const switches: SwitchRecord[] = [];
  const results = new Map<string, EventResult>();
  let eventIndex = 0;

  for (let tick = startTick; tick < endTick; tick += 1) {
    const arrivals: StreamEvent[] = [];
    while (eventIndex < events.length && events[eventIndex].tick === tick) {
      arrivals.push(events[eventIndex]);
      eventIndex += 1;
    }

    const admitted = admitEvents(ctx, carry, source, arrivals, tick, results);
    carry.queued.push(...admitted);

    // 消费：按到达顺序出队并标记 consumed（速率支持非整数，小数部分累计）
    const tier = ctx.tierById.get(carry.tierId) ?? ctx.baseTier;
    carry.rateCarry += tier.rate;
    const toConsume = Math.min(Math.floor(carry.rateCarry), carry.queued.length);
    carry.rateCarry = Math.max(0, carry.rateCarry - toConsume);
    for (let i = 0; i < toConsume; i += 1) {
      const event = carry.queued.shift()!;
      // 事件可能在此前块中已被记录；此处 get-or-create 以保证 consumed 状态被合并
      touchResult(results, event).disposition = 'consumed';
    }

    const backlog = carry.queued.length;

    // 档位评估（切换自下一 tick 生效）。
    // 暂停期间冻结评估（暂停语义 = 该来源调节挂起）；
    // 最后一个 tick 不评估（新档位将超出时间轴，无生效区间）。
    const paused = carry.pausedUntil >= 0 && tick < carry.pausedUntil;
    const evaluation =
      paused || tick + 1 > ctx.horizon
        ? null
        : evaluateTier(ctx, carry, source, tick, backlog);
    if (evaluation) {
      // 关闭上一窗口
      if (carry.openSwitch) {
        carry.openSwitch.affectedTo = tick;
        carry.openSwitch.affectedEventCount = carry.windowAffected;
        switches.push(carry.openSwitch);
      }
      carry.switchSeq += 1;
      carry.windowStart = tick + 1;
      carry.windowAffected = 0;
      carry.downsampleCounter = 0;
      carry.dropCounter = 0;
      carry.windowOrigin = evaluation.origin;
      carry.tierId = evaluation.nextTier.id;
      carry.openSwitch = evaluation.record;
      applyEntryAction(ctx, carry, evaluation.nextTier, tick + 1);
    }

    samples.push({
      tick,
      backlog,
      capacity: carry.capacity === Infinity ? -1 : carry.capacity,
      tierId: carry.tierId,
      paused: carry.pausedUntil >= 0 && tick < carry.pausedUntil,
    });
  }

  carry.tick = endTick;
  return {
    startTick,
    endTick,
    inputHash: '',
    carryIn: cloneCarry(carryIn),
    samples,
    switches,
    eventResults: [...results.values()],
    carryOut: carry,
  };
}
