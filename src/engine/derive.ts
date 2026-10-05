import { admittedEventIds } from './events';
import type {
  CurvePoint,
  Decision,
  Derivation,
  EngineParams,
  EventSet,
} from './types';

/**
 * 每个区间的输入：
 * - load：该区间被准入事件的工作量之和；
 * - disputed：该区间含待裁决事件（双方保留但未裁决）。
 */
interface TickInput {
  load: number;
  disputed: boolean;
  ids: string[];
}

interface Context {
  inputs: Map<number, TickInput>;
  maxTick: number;
}

function prepareContext(set: EventSet, params: EngineParams): Context {
  const admitted = admittedEventIds(set);
  const inputs = new Map<number, TickInput>();
  let maxTick = -1;

  const ensure = (tick: number): TickInput => {
    let input = inputs.get(tick);
    if (!input) {
      input = { load: 0, disputed: false, ids: [] };
      inputs.set(tick, input);
    }
    return input;
  };

  for (const event of set.events) {
    const tick = Math.floor(event.timestamp / params.tickMs);
    if (tick > maxTick) maxTick = tick;
    const input = ensure(tick);
    input.ids.push(event.id);
    if (admitted.has(event.id)) input.load += event.size;
  }

  for (const group of set.conflicts) {
    if (group.status !== 'pending') continue;
    const tick = Math.floor(group.timestamp / params.tickMs);
    if (tick > maxTick) maxTick = tick;
    ensure(tick).disputed = true;
  }

  return { inputs, maxTick };
}

function inputsEqual(a: TickInput | undefined, b: TickInput | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.load !== b.load || a.disputed !== b.disputed) return false;
  if (a.ids.length !== b.ids.length) return false;
  return a.ids.every((id, index) => id === b.ids[index]);
}

/** 最早/最晚发生差异的区间；完全一致时为 Infinity */
function diffRange(
  prev: Context,
  next: Context,
): { first: number; last: number } {
  let first = Infinity;
  let last = -1;
  const ticks = new Set<number>([...prev.inputs.keys(), ...next.inputs.keys()]);
  for (const tick of ticks) {
    if (!inputsEqual(prev.inputs.get(tick), next.inputs.get(tick))) {
      if (tick < first) first = tick;
      if (tick > last) last = tick;
    }
  }
  return { first, last };
}

function curveParamsEqual(a: EngineParams, b: EngineParams): boolean {
  return (
    a.tickMs === b.tickMs &&
    a.consumeRate === b.consumeRate &&
    a.burstLimit === b.burstLimit
  );
}

/** 单区间积压递推：突发上限准入 -> 消费 -> 区间末积压（恒非负） */
function step(
  backlog: number,
  carry: number,
  input: TickInput | undefined,
  params: EngineParams,
): { point: Omit<CurvePoint, 'tick' | 'time' | 'disputed' | 'bpActive'>; backlog: number; carry: number } {
  const offered = (input?.load ?? 0) + carry;
  const arrivals = Math.min(offered, params.burstLimit);
  const spilledOut = offered - arrivals;
  const consumed = Math.min(backlog + arrivals, params.consumeRate);
  const nextBacklog = backlog + arrivals - consumed;
  return {
    point: {
      arrivals,
      spilledIn: carry,
      spilledOut,
      consumed,
      backlog: nextBacklog,
    },
    backlog: nextBacklog,
    carry: spilledOut,
  };
}

/** 待裁决区间之后，为排空积压追加的区间数硬上限 */
const DRAIN_CAP = 5000;

function deriveDecisions(
  curve: CurvePoint[],
  set: EventSet,
  params: EngineParams,
): Decision[] {
  const decisions: Decision[] = [];
  let active = false;
  let seq = 0;

  for (const point of curve) {
    let type: Decision['type'] | null = null;
    if (!point.disputed) {
      if (!active && point.backlog > params.highThreshold) type = 'trigger';
      else if (active && point.backlog <= params.lowThreshold) type = 'release';
    }
    if (type) {
      active = type === 'trigger';
      seq += 1;
      const isTrigger = type === 'trigger';
      decisions.push({
        seq,
        tick: point.tick,
        time: point.time,
        type,
        action: isTrigger ? '开启背压：限流并降级非关键消费' : '解除背压：恢复正常消费速率',
        backlog: point.backlog,
        threshold: isTrigger ? params.highThreshold : params.lowThreshold,
        thresholdKind: isTrigger ? 'high' : 'low',
        explanation:
          `区间 #${point.tick}（t=${point.time}ms）：区间末积压 ${point.backlog} ` +
          (isTrigger
            ? `高于触发阈值 highThreshold=${params.highThreshold}，背压开启。`
            : `回落到解除阈值 lowThreshold=${params.lowThreshold}（含）以下，背压解除。`) +
          ` 依据：事件集 v${set.version} / 参数 v${params.version}`,
        basis: { eventsVersion: set.version, paramsVersion: params.version },
      });
    }
    point.bpActive = active;
  }
  return decisions;
}

function finish(
  points: CurvePoint[],
  set: EventSet,
  params: EngineParams,
  rederivedTicks: number,
  reusedTicks: number,
): Derivation {
  const decisions = deriveDecisions(points, set, params);
  let peakBacklog = 0;
  let peakTick = 0;
  const disputedTicks: number[] = [];
  for (const point of points) {
    if (point.backlog > peakBacklog) {
      peakBacklog = point.backlog;
      peakTick = point.tick;
    }
    if (point.disputed) disputedTicks.push(point.tick);
  }
  return {
    curve: points,
    decisions,
    disputedTicks,
    stats: { peakBacklog, peakTick, rederivedTicks, reusedTicks },
    basis: { eventsVersion: set.version, paramsVersion: params.version },
  };
}

function runFrom(
  ctx: Context,
  set: EventSet,
  params: EngineParams,
): { points: CurvePoint[]; rederivedTicks: number; reusedTicks: number } {
  const points: CurvePoint[] = [];
  let backlog = 0;
  let carry = 0;
  const minTicks = ctx.maxTick + 1;
  let tick = 0;
  while (tick < minTicks || ((backlog > 0 || carry > 0) && tick < minTicks + DRAIN_CAP)) {
    const input = ctx.inputs.get(tick);
    const { point, backlog: nextBacklog, carry: nextCarry } = step(backlog, carry, input, params);
    points.push({
      tick,
      time: tick * params.tickMs,
      disputed: input?.disputed ?? false,
      bpActive: false,
      ...point,
    });
    backlog = nextBacklog;
    carry = nextCarry;
    tick += 1;
  }
  return { points, rederivedTicks: tick, reusedTicks: 0 };
}

/** 整体重推 */
export function fullDerive(set: EventSet, params: EngineParams): Derivation {
  const ctx = prepareContext(set, params);
  const { points } = runFrom(ctx, set, params);
  return finish(points, set, params, points.length, 0);
}

/**
 * 逐区间重推：
 * - 仅阈值变化：积压曲线一个区间都不重推，只重新判定决策；
 * - 事件修正/裁决：从最早受影响区间重推；
 * - 消费速率/突发上限/区间长度变化：从区间 0 重推；
 * - 递推状态（区间末积压、顺延量）在某边界与旧结果重合后，
 *   后续区间直接复用旧点；决策是曲线+阈值的纯函数，复用区间的结论天然一致。
 */
export function incrementalDerive(
  prevSet: EventSet,
  prevParams: EngineParams,
  prev: Derivation,
  set: EventSet,
  params: EngineParams,
): Derivation {
  const sameTickMs = prevParams.tickMs === params.tickMs;
  const sameCurveParams = sameTickMs && curveParamsEqual(prevParams, params);

  const prevCtx = prepareContext(prevSet, prevParams);
  const ctx = prepareContext(set, params);
  const { first, last } = sameTickMs
    ? diffRange(prevCtx, ctx)
    : { first: 0, last: Infinity };

  // 曲线完全不受影响（仅阈值变化）：逐点复用旧曲线
  if (sameCurveParams && first === Infinity) {
    const points = prev.curve.map((point) => ({ ...point }));
    return finish(points, set, params, 0, points.length);
  }

  const startTick = sameCurveParams ? Math.min(first, ctx.maxTick + 1) : 0;
  const points: CurvePoint[] = prev.curve
    .slice(0, startTick)
    .map((point) => ({ ...point }));

  let backlog = 0;
  let carry = 0;
  if (startTick > 0 && startTick - 1 < prev.curve.length) {
    backlog = prev.curve[startTick - 1].backlog;
    carry = prev.curve[startTick - 1].spilledOut;
  }

  const minTicks = ctx.maxTick + 1;
  let tick = startTick;
  let junction = -1;

  while (
    tick < minTicks ||
    ((backlog > 0 || carry > 0) && tick < minTicks + DRAIN_CAP)
  ) {
    // 所有差异区间都已重推完，且边界状态与旧结果逐点一致：后缀可安全复用
    if (
      sameCurveParams &&
      tick > last &&
      tick > startTick &&
      tick < prev.curve.length &&
      prev.curve[tick - 1].backlog === backlog &&
      prev.curve[tick - 1].spilledOut === carry
    ) {
      junction = tick;
      break;
    }

    const input = ctx.inputs.get(tick);
    const { point, backlog: nextBacklog, carry: nextCarry } = step(backlog, carry, input, params);
    points.push({
      tick,
      time: tick * params.tickMs,
      disputed: input?.disputed ?? false,
      bpActive: false,
      ...point,
    });
    backlog = nextBacklog;
    carry = nextCarry;
    tick += 1;
  }

  let reused = 0;
  if (junction >= 0) {
    for (let index = junction; index < prev.curve.length; index += 1) {
      points.push({ ...prev.curve[index] });
      reused += 1;
    }
  }

  return finish(points, set, params, junction >= 0 ? junction - startTick : tick - startTick, reused);
}

/** 校验两次派生（逐区间重推 vs 整体重推）是否逐点一致 */
export function derivationsEqual(
  expected: Derivation,
  actual: Derivation,
): { equal: boolean; reason?: string } {
  if (expected.curve.length !== actual.curve.length) {
    return {
      equal: false,
      reason: `曲线区间数不一致：${expected.curve.length} vs ${actual.curve.length}`,
    };
  }
  for (let index = 0; index < expected.curve.length; index += 1) {
    const a = expected.curve[index];
    const b = actual.curve[index];
    const fields: (keyof CurvePoint)[] = [
      'tick', 'time', 'arrivals', 'spilledIn', 'spilledOut', 'consumed',
      'backlog', 'disputed', 'bpActive',
    ];
    for (const field of fields) {
      if (a[field] !== b[field]) {
        return { equal: false, reason: `区间 #${index} 的 ${field} 不一致：${a[field]} vs ${b[field]}` };
      }
    }
  }
  if (expected.decisions.length !== actual.decisions.length) {
    return {
      equal: false,
      reason: `决策数量不一致：${expected.decisions.length} vs ${actual.decisions.length}`,
    };
  }
  for (let index = 0; index < expected.decisions.length; index += 1) {
    const a = expected.decisions[index];
    const b = actual.decisions[index];
    const fields: (keyof Decision)[] = [
      'seq', 'tick', 'time', 'type', 'action', 'backlog',
      'threshold', 'thresholdKind', 'explanation',
    ];
    for (const field of fields) {
      if (a[field] !== b[field]) return { equal: false, reason: `决策 #${index + 1} 的 ${field} 不一致` };
    }
    if (
      a.basis.eventsVersion !== b.basis.eventsVersion ||
      a.basis.paramsVersion !== b.basis.paramsVersion
    ) {
      return { equal: false, reason: `决策 #${index + 1} 的依据版本不一致` };
    }
  }
  return { equal: true };
}
