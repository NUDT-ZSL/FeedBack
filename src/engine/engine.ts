import { EventStore } from './eventStore';
import type {
  Basis,
  ConflictGroup,
  Decision,
  EngineResult,
  IntervalResult,
  Params,
  ParamsVersion,
  StreamEvent,
} from './types';

/** 单个区间的输入：与携带状态无关，可指纹化 */
interface IntervalInput {
  start: number;
  /** null 表示开放末段（最后一个边界之后） */
  end: number | null;
  events: StreamEvent[];
  pendingGroups: ConflictGroup[];
  paramsVersion: ParamsVersion;
}

interface Cache {
  fingerprints: string[];
  intervals: IntervalResult[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * 背压调节引擎。
 *
 * 时间轴被切分为若干区间（边界 = 事件时刻 ∪ 参数生效时刻 ∪ {0}），
 * 每个区间的推算是 (区间输入, 进入状态) 的纯函数，因此：
 * - 整体重推 = 从 0 开始逐区间计算；
 * - 增量重推 = 复用输入指纹与进入状态均未变化的区间，只重推受影响区间，
 *   二者结果必然逐点一致。
 */
export class BackpressureEngine {
  readonly store = new EventStore();
  private paramsHistory: ParamsVersion[];
  private paramsCounter = 0;
  private cache: Cache | null = null;

  constructor(initialParams: Params) {
    this.paramsHistory = [{ params: initialParams, version: ++this.paramsCounter, fromTime: 0 }];
  }

  get paramsVersion(): number {
    return this.paramsCounter;
  }

  get currentParams(): Params {
    return this.paramsHistory[this.paramsHistory.length - 1].params;
  }

  /** 参数调整：从 fromTime 起生效，只影响该时刻之后的区间 */
  setParams(params: Params, fromTime: number): void {
    if (fromTime < 0) throw new Error('fromTime 不能为负');
    this.paramsHistory.push({ params, version: ++this.paramsCounter, fromTime });
    this.paramsHistory.sort((a, b) => a.fromTime - b.fromTime || a.version - b.version);
  }

  /** 增量路径：复用未受影响区间的缓存结果，只重推受影响区间 */
  compute(): EngineResult {
    const inputs = this.buildInputs();
    const result = this.run(inputs, this.cache);
    this.cache = {
      fingerprints: inputs.map(fingerprint),
      intervals: result.intervals.map((r) => ({ ...r, reusedFromCache: false })),
    };
    return result;
  }

  /** 整体路径：从零重推全部区间（验收对照路径，不影响增量缓存） */
  fullRecompute(): EngineResult {
    return this.run(this.buildInputs(), null);
  }

  private paramsAt(time: number): ParamsVersion {
    let chosen = this.paramsHistory[0];
    for (const pv of this.paramsHistory) {
      if (pv.fromTime <= time) chosen = pv;
      else break;
    }
    return chosen;
  }

  private buildInputs(): IntervalInput[] {
    const events = this.store.resolvedEvents();
    const pending = this.store.pendingGroups();
    const boundarySet = new Set<number>([0]);
    for (const e of events) boundarySet.add(e.time);
    for (const g of pending) boundarySet.add(g.time);
    for (const pv of this.paramsHistory) boundarySet.add(pv.fromTime);
    const boundaries = [...boundarySet].sort((a, b) => a - b);

    const eventsByTime = new Map<number, StreamEvent[]>();
    for (const e of events) {
      const list = eventsByTime.get(e.time) ?? [];
      list.push(e);
      eventsByTime.set(e.time, list);
    }
    const pendingByTime = new Map<number, ConflictGroup[]>();
    for (const g of pending) {
      const list = pendingByTime.get(g.time) ?? [];
      list.push(g);
      pendingByTime.set(g.time, list);
    }

    return boundaries.map((start, i) => ({
      start,
      end: i + 1 < boundaries.length ? boundaries[i + 1] : null,
      events: eventsByTime.get(start) ?? [],
      pendingGroups: pendingByTime.get(start) ?? [],
      paramsVersion: this.paramsAt(start),
    }));
  }

  private run(inputs: IntervalInput[], cache: Cache | null): EngineResult {
    const basis: Basis = {
      eventVersion: this.store.version,
      paramsVersion: this.paramsCounter,
    };
    const intervals: IntervalResult[] = [];
    let carry = 0;
    let active = false;

    for (let i = 0; i < inputs.length; i++) {
      const cached = cache?.intervals[i];
      const hit =
        cached !== undefined &&
        cache!.fingerprints[i] === fingerprint(inputs[i]) &&
        cached.carryIn === carry &&
        cached.backpressureActiveIn === active;
      if (hit) {
        intervals.push({ ...cached, reusedFromCache: true });
        carry = cached.carryOut;
        active = cached.backpressureActiveOut;
      } else {
        const intervalBasis: Basis = {
          eventVersion: basis.eventVersion,
          paramsVersion: inputs[i].paramsVersion.version,
        };
        const r = computeInterval(inputs[i], i, carry, active, intervalBasis);
        intervals.push(r);
        carry = r.carryOut;
        active = r.backpressureActiveOut;
      }
    }

    const curve: Array<{ time: number; backlog: number }> = [];
    const push = (time: number, backlog: number) => {
      const last = curve[curve.length - 1];
      if (!last || last.time !== time || last.backlog !== backlog) curve.push({ time, backlog });
    };
    for (const r of intervals) {
      push(r.start, r.carryIn);
      if (r.arrivals > 0) push(r.start, r.carryIn + r.arrivals);
      push(r.end, r.carryOut);
    }

    const totalArrived = this.store.resolvedEvents().reduce((s, e) => s + e.size, 0);
    const currentBacklog = intervals.length > 0 ? intervals[intervals.length - 1].carryOut : 0;

    return {
      intervals,
      decisions: intervals.flatMap((r) => r.decisions),
      curve,
      currentBacklog,
      totalArrived,
      totalConsumed: totalArrived - currentBacklog,
      eventVersion: basis.eventVersion,
      paramsVersion: basis.paramsVersion,
    };
  }
}

function fingerprint(input: IntervalInput): string {
  const arrivals = input.events.reduce((s, e) => s + e.size, 0);
  const excluded = input.pendingGroups
    .flatMap((g) => g.events)
    .reduce((s, e) => s + e.size, 0);
  return JSON.stringify({
    start: input.start,
    end: input.end,
    ev: input.events.map((e) => `${e.id}:${e.size}`),
    arrivals,
    tainted: input.pendingGroups.length > 0,
    excluded,
    pv: input.paramsVersion.version,
  });
}

/**
 * 单区间推算（纯函数）：
 * 到达量在区间起点瞬时计入，随后按消费速率线性回落（不低于 0）。
 * 开放末段（end=null）的终点取积压刚好排空（或速率为零时保持）的时刻。
 */
function computeInterval(
  input: IntervalInput,
  index: number,
  carryIn: number,
  activeIn: boolean,
  basis: Basis,
): IntervalResult {
  const { consumeRate, threshold, burstLimit } = input.paramsVersion.params;
  const arrivals = input.events.reduce((s, e) => s + e.size, 0);
  const excludedArrivals = input.pendingGroups
    .flatMap((g) => g.events)
    .reduce((s, e) => s + e.size, 0);
  const tainted = input.pendingGroups.length > 0;

  const afterArrivals = carryIn + arrivals;
  const duration =
    input.end !== null
      ? input.end - input.start
      : consumeRate > 0
        ? afterArrivals / consumeRate
        : 0;
  const end = input.start + duration;
  const carryOut = Math.max(0, afterArrivals - consumeRate * duration);

  const decisions: Decision[] = [];
  let activeOut = activeIn;
  const range =
    input.end !== null
      ? `[${fmt(input.start)}s, ${fmt(input.end)}s)`
      : `[${fmt(input.start)}s, +∞)`;

  if (!tainted) {
    if (arrivals > burstLimit) {
      decisions.push({
        id: `i${index}-burst`,
        kind: 'burst',
        intervalIndex: index,
        time: input.start,
        backlog: afterArrivals,
        rule: 'burst-limit-exceeded',
        explanation:
          `区间#${index} ${range}：瞬时到达 ${fmt(arrivals)} 超过突发上限 ` +
          `${fmt(burstLimit)}（参数v${basis.paramsVersion}），当时积压 ${fmt(afterArrivals)}`,
        basis,
      });
    }
    let active = activeIn;
    if (!active && afterArrivals > threshold) {
      decisions.push({
        id: `i${index}-trigger`,
        kind: 'trigger',
        intervalIndex: index,
        time: input.start,
        backlog: afterArrivals,
        rule: 'threshold-exceeded',
        explanation:
          `区间#${index} ${range}：积压 ${fmt(afterArrivals)} 超过阈值 ` +
          `${fmt(threshold)}（参数v${basis.paramsVersion}），于 ${fmt(input.start)}s 触发背压`,
        basis,
      });
      active = true;
    }
    if (active && afterArrivals <= threshold) {
      // 参数调整（阈值上调/速率提高）后，进入区间时已不越限：起点即解除
      decisions.push({
        id: `i${index}-release`,
        kind: 'release',
        intervalIndex: index,
        time: input.start,
        backlog: afterArrivals,
        rule: 'threshold-reached-below',
        explanation:
          `区间#${index} ${range}：积压 ${fmt(afterArrivals)} 已不高于阈值 ` +
          `${fmt(threshold)}（参数v${basis.paramsVersion}），于 ${fmt(input.start)}s 解除背压`,
        basis,
      });
      active = false;
    } else if (active && consumeRate > 0 && carryOut <= threshold) {
      // 区间内回落至阈值：精确求解穿越时刻
      const releaseTime = input.start + (afterArrivals - threshold) / consumeRate;
      decisions.push({
        id: `i${index}-release`,
        kind: 'release',
        intervalIndex: index,
        time: releaseTime,
        backlog: threshold,
        rule: 'threshold-reached-below',
        explanation:
          `区间#${index} ${range}：积压回落至阈值 ${fmt(threshold)}（参数v${basis.paramsVersion}），` +
          `于 ${fmt(releaseTime)}s 解除背压（消费速率 ${fmt(consumeRate)}/s）`,
        basis,
      });
      active = false;
    }
    activeOut = active;
  }

  return {
    index,
    start: input.start,
    end,
    arrivals,
    excludedArrivals,
    tainted,
    withheld: tainted,
    carryIn,
    peak: afterArrivals,
    carryOut,
    backpressureActiveIn: activeIn,
    backpressureActiveOut: activeOut,
    decisions,
    basis,
    reusedFromCache: false,
  };
}
