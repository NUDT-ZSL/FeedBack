import {
  Adjudication,
  BacklogSample,
  EventDecision,
  NormEvent,
  SimConfig,
  SimResult,
  SwitchRecord,
  TierConfig,
} from "./types";
import { resolveTiers, ResolvedTiers } from "./validate";

/** 队列/暂存中的事件条目：decidedBy 记录入队依据（切换记录 id 或 "base"）。 */
interface Slot {
  ev: NormEvent;
  decidedBy: string;
}

/** 可恢复快照：增量重推的断点。 */
export interface Snapshot {
  time: number;
  /** 下一个待处理事件下标（之前的批次已全部处理完）。 */
  arrivalIdx: number;
  queue: { id: string; decidedBy: string }[];
  held: Record<string, { id: string; decidedBy: string }[]>;
  headProgress: number;
  activeTierId: string | null;
  downsampleSeq: number;
  switchCount: number;
  seriesLength: number;
  /** 快照时刻暂存/在途、结论尚未最终确定的事件 id。 */
  provisionalIds: string[];
}

export interface SimOutput extends SimResult {
  snapshots: Snapshot[];
  normEvents: NormEvent[];
}

type RawSwitch = Omit<SwitchRecord, "range">;

export interface ResumePoint {
  snapshot: Snapshot;
  /** 快照前已最终确定的事件结论。 */
  decisions: Map<string, EventDecision>;
  switches: RawSwitch[];
  series: BacklogSample[];
}

const SNAPSHOT_EVERY_BATCHES = 8;
const MAX_TRANSITIONS = 100000;

interface Engine {
  now: number;
  arrivalIdx: number;
  queue: Slot[];
  head: number;
  headProgress: number;
  activeTier: TierConfig | null;
  downsampleSeq: number;
  held: Map<string, Slot[]>;
  decisions: Map<string, EventDecision>;
  switches: RawSwitch[];
  series: BacklogSample[];
  perSource: Map<string, number>;
  snapshots: Snapshot[];
}

function pushHistory(d: EventDecision | undefined, basis: string): string[] {
  const h = d?.history ? [...d.history] : [];
  h.push(basis);
  return h;
}

/**
 * 运行仿真。resume 存在时从快照恢复状态继续推进，
 * 输出与从头整体重推完全一致（由 verify.ts 校验）。
 */
export function runSimulation(
  normEvents: NormEvent[],
  config: SimConfig,
  adjudications: Adjudication[] = [],
  resolved?: ResolvedTiers,
  resume?: ResumePoint,
): SimOutput {
  const rt = resolved ?? resolveTiers(config, adjudications);
  const ordered = rt.ordered;
  const byId = new Map(ordered.map((t) => [t.id, t]));
  const baseCapacity = config.baseCapacity ?? Infinity;

  const eng: Engine = {
    now: 0,
    arrivalIdx: 0,
    queue: [],
    head: 0,
    headProgress: 0,
    activeTier: null,
    downsampleSeq: 0,
    held: new Map(),
    decisions: new Map(),
    switches: [],
    series: [],
    perSource: new Map(),
    snapshots: [],
  };

  if (resume) {
    const s = resume.snapshot;
    const evById = new Map(normEvents.map((e) => [e.id, e]));
    eng.now = s.time;
    eng.arrivalIdx = s.arrivalIdx;
    eng.queue = s.queue.map((q) => ({ ev: evById.get(q.id)!, decidedBy: q.decidedBy }));
    eng.head = 0;
    eng.headProgress = s.headProgress;
    eng.activeTier = s.activeTierId ? byId.get(s.activeTierId) ?? null : null;
    eng.downsampleSeq = s.downsampleSeq;
    eng.held = new Map(
      Object.entries(s.held).map(([src, arr]) => [
        src,
        arr.map((q) => ({ ev: evById.get(q.id)!, decidedBy: q.decidedBy })),
      ]),
    );
    eng.decisions = new Map(resume.decisions);
    // 恢复在途/暂存事件的临时结论
    for (const q of s.queue) {
      const ev = evById.get(q.id)!;
      eng.decisions.set(ev.id, {
        eventId: ev.id,
        sourceId: ev.sourceId,
        arrivalTime: ev.arrivalTime,
        status: "kept",
        decidedBy: q.decidedBy,
        history: [q.decidedBy],
      });
    }
    for (const arr of Object.values(s.held)) {
      for (const q of arr) {
        const ev = evById.get(q.id)!;
        eng.decisions.set(ev.id, {
          eventId: ev.id,
          sourceId: ev.sourceId,
          arrivalTime: ev.arrivalTime,
          status: "held",
          decidedBy: q.decidedBy,
          history: [q.decidedBy],
        });
      }
    }
    eng.switches = resume.switches.map((sw) => ({ ...sw, effects: { ...sw.effects, trimmedEventIds: [...sw.effects.trimmedEventIds] } }));
    eng.series = resume.series.slice();
    for (const q of eng.queue) {
      eng.perSource.set(q.ev.sourceId, (eng.perSource.get(q.ev.sourceId) ?? 0) + 1);
    }
  }

  const backlog = () => eng.queue.length - eng.head;
  const capacity = () =>
    eng.activeTier?.action.type === "expandBuffer"
      ? eng.activeTier.action.capacity ?? baseCapacity
      : baseCapacity;
  const rate = () => eng.activeTier?.consumeRate ?? config.baseConsumeRate;
  const releaseBelow = (t: TierConfig) => t.releaseBelow ?? t.threshold;
  const isPaused = (sourceId: string) => {
    const t = eng.activeTier;
    if (!t || t.action.type !== "pauseSource") return false;
    return t.action.sources ? t.action.sources.includes(sourceId) : true;
  };
  const basis = () =>
    eng.switches.length ? eng.switches[eng.switches.length - 1].id : "base";

  const sample = () => {
    const per: Record<string, number> = {};
    // 键按字典序输出：保证增量续推与整体重推的序列化结果逐字节一致
    for (const k of [...eng.perSource.keys()].sort()) {
      const v = eng.perSource.get(k)!;
      if (v > 0) per[k] = v;
    }
    eng.series.push({
      time: eng.now,
      total: backlog(),
      perSource: per,
      tierId: eng.activeTier?.id ?? null,
    });
  };

  const snapshot = () => {
    const queueSnap = eng.queue
      .slice(eng.head)
      .map((s) => ({ id: s.ev.id, decidedBy: s.decidedBy }));
    const heldSnap: Record<string, { id: string; decidedBy: string }[]> = {};
    const provisional: string[] = queueSnap.map((q) => q.id);
    for (const [src, arr] of eng.held) {
      heldSnap[src] = arr.map((s) => ({ id: s.ev.id, decidedBy: s.decidedBy }));
      for (const s of arr) provisional.push(s.ev.id);
    }
    eng.snapshots.push({
      time: eng.now,
      arrivalIdx: eng.arrivalIdx,
      queue: queueSnap,
      held: heldSnap,
      headProgress: eng.headProgress,
      activeTierId: eng.activeTier?.id ?? null,
      downsampleSeq: eng.downsampleSeq,
      switchCount: eng.switches.length,
      seriesLength: eng.series.length,
      provisionalIds: provisional,
    });
  };

  const setDecision = (slot: Slot, status: EventDecision["status"], by: string) => {
    const prev = eng.decisions.get(slot.ev.id);
    eng.decisions.set(slot.ev.id, {
      eventId: slot.ev.id,
      sourceId: slot.ev.sourceId,
      arrivalTime: slot.ev.arrivalTime,
      status,
      decidedBy: by,
      history: pushHistory(prev, by),
    });
  };

  const admit = (ev: NormEvent) => {
    const by = basis();
    const slot: Slot = { ev, decidedBy: by };
    const tier = eng.activeTier;
    if (tier?.action.type === "drop") {
      setDecision(slot, "dropped-admit", by);
      return;
    }
    if (tier?.action.type === "downsample") {
      const r = tier.action.keepRatio ?? 1;
      eng.downsampleSeq += 1;
      const keep =
        Math.floor(eng.downsampleSeq * r) > Math.floor((eng.downsampleSeq - 1) * r);
      if (!keep) {
        setDecision(slot, "downsampled-out", by);
        return;
      }
    }
    if (backlog() >= capacity()) {
      setDecision(slot, "dropped-overflow", by);
      return;
    }
    eng.queue.push(slot);
    eng.perSource.set(ev.sourceId, (eng.perSource.get(ev.sourceId) ?? 0) + 1);
    setDecision(slot, "kept", by);
    // 准入即采样：捕捉批次中途的积压峰值，
    // 增量重推的影响区间分析依赖这些峰值点定位首次越限时刻。
    sample();
  };

  const doSwitch = (toTier: TierConfig | null, direction: SwitchRecord["direction"], adjId?: string) => {
    const from = eng.activeTier;
    const id = `sw#${eng.switches.length + 1}`;
    const threshold =
      direction === "release" && from ? releaseBelow(from) : toTier?.threshold ?? 0;
    const rule =
      direction === "release"
        ? `积压 ${backlog()} 回落至档位 ${from!.id} 的释放线 ${threshold} 以下`
        : `积压 ${backlog()} 达到档位 ${toTier!.id} 的阈值 ${threshold}`;
    const sw: RawSwitch = {
      id,
      time: eng.now,
      fromTier: from?.id ?? null,
      toTier: toTier?.id ?? null,
      direction,
      trigger: { backlog: backlog(), threshold, rule },
      effects: { trimmedEventIds: [], capacity: 0 },
      adjudicationId: adjId,
    };
    eng.activeTier = toTier;
    eng.downsampleSeq = 0;
    // 容量变化 → 从队尾裁掉最新进入的事件
    const cap = capacity();
    while (backlog() > cap) {
      const dropped = eng.queue.pop()!;
      eng.perSource.set(
        dropped.ev.sourceId,
        (eng.perSource.get(dropped.ev.sourceId) ?? 1) - 1,
      );
      setDecision(dropped, "dropped-trim", id);
      sw.effects.trimmedEventIds.push(dropped.ev.id);
    }
    sw.effects.capacity = cap === Infinity ? -1 : cap;
    eng.switches.push(sw);
    sample();
  };

  const evaluateTransitions = () => {
    // 同一轮评估内每个档位最多激活一次：
    // 防止「扩容收缩容量 → 积压跌破释放线 → 再次升级」的确定性震荡。
    const activatedThisPass = new Set<string>();
    for (let guard = 0; guard < MAX_TRANSITIONS; guard++) {
      const b = backlog();
      if (eng.activeTier && b < releaseBelow(eng.activeTier)) {
        doSwitch(null, "release");
        continue;
      }
      const candidates = ordered.filter(
        (t) => t.threshold <= b && (!eng.activeTier || t.threshold > eng.activeTier.threshold),
      );
      if (candidates.length > 0) {
        let target = candidates[candidates.length - 1];
        const explicitId =
          eng.activeTier && !rt.cycleBreaks.has(eng.activeTier.id)
            ? eng.activeTier.escalateTo
            : undefined;
        if (explicitId) {
          const explicit = candidates.find((c) => c.id === explicitId);
          if (explicit) target = explicit;
        }
        if (activatedThisPass.has(target.id)) break;
        activatedThisPass.add(target.id);
        doSwitch(target, "escalate");
        continue;
      }
      // 解除暂停：当前档位不再暂停的来源，其暂存事件按原顺序准入；
      // 准入会改变积压，需重新评估切换。
      let unheld = false;
      for (const [src, arr] of eng.held) {
        if (!isPaused(src) && arr.length > 0) {
          const releasing = arr.splice(0, arr.length);
          for (const slot of releasing) admit(slot.ev);
          unheld = true;
        }
      }
      if (!unheld) break;
    }
  };

  const drain = (toTime: number) => {
    while (backlog() > 0) {
      const r = rate();
      if (r <= 0) break;
      const remaining = 1 - eng.headProgress;
      const dt = remaining / r;
      if (eng.now + dt > toTime) {
        eng.headProgress += (toTime - eng.now) * r;
        eng.now = toTime;
        return;
      }
      eng.now += dt;
      const done = eng.queue[eng.head];
      eng.head += 1;
      eng.headProgress = 0;
      eng.perSource.set(
        done.ev.sourceId,
        (eng.perSource.get(done.ev.sourceId) ?? 1) - 1,
      );
      const d = eng.decisions.get(done.ev.id);
      if (d) d.consumedAt = eng.now;
      sample();
      evaluateTransitions();
    }
    if (toTime !== Infinity && eng.now < toTime) {
      eng.now = toTime;
      eng.headProgress = 0;
    }
  };

  // ---- 主循环 ----
  if (!resume && normEvents.length > 0) {
    eng.now = normEvents[0].arrivalTime;
  }
  let batchCount = 0;
  let switchesAtLastSnapshot = eng.switches.length;
  let i = eng.arrivalIdx;
  while (i < normEvents.length) {
    const t = normEvents[i].arrivalTime;
    drain(t);
    // 同一时刻多条事件：按 (arrivalTime, inputIndex) 顺序逐条准入，
    // 每条准入后即评估档位切换，保证并发触发顺序确定。
    let j = i;
    while (j < normEvents.length && normEvents[j].arrivalTime === t) {
      const ev = normEvents[j];
      if (isPaused(ev.sourceId)) {
        const by = basis();
        const slot: Slot = { ev, decidedBy: by };
        if (!eng.held.has(ev.sourceId)) eng.held.set(ev.sourceId, []);
        eng.held.get(ev.sourceId)!.push(slot);
        setDecision(slot, "held", by);
      } else {
        admit(ev);
        evaluateTransitions();
      }
      j += 1;
    }
    eng.arrivalIdx = j;
    i = j;
    batchCount += 1;
    if (
      batchCount % SNAPSHOT_EVERY_BATCHES === 0 ||
      eng.switches.length !== switchesAtLastSnapshot
    ) {
      snapshot();
      switchesAtLastSnapshot = eng.switches.length;
    }
  }
  drain(Infinity);
  const endTime = eng.now;

  // 仿真结束时仍在队列/暂存中的事件：显式标记，不静默丢弃
  for (let k = eng.head; k < eng.queue.length; k++) {
    const slot = eng.queue[k];
    const d = eng.decisions.get(slot.ev.id);
    if (d && d.status === "kept" && d.consumedAt === undefined) d.status = "queued";
  }

  // 填充切换记录的受影响事件区间 [start, end)
  const switches: SwitchRecord[] = eng.switches.map((sw, idx) => ({
    ...sw,
    range: {
      start: sw.time,
      end: idx + 1 < eng.switches.length ? eng.switches[idx + 1].time : endTime,
    },
  }));

  const order = new Map(normEvents.map((e, idx) => [e.id, idx]));
  const events = [...eng.decisions.values()].sort(
    (a, b) => (order.get(a.eventId) ?? 0) - (order.get(b.eventId) ?? 0),
  );

  const stats = {
    totalEvents: events.length,
    kept: events.filter((e) => e.status === "kept").length,
    dropped: events.filter((e) => e.status.startsWith("dropped")).length,
    downsampledOut: events.filter((e) => e.status === "downsampled-out").length,
    held: events.filter((e) => e.status === "held").length,
    queued: events.filter((e) => e.status === "queued").length,
    endTime,
  };

  return {
    events,
    switches,
    series: eng.series,
    issues: [],
    configIssues: [],
    stats,
    snapshots: eng.snapshots,
    normEvents,
  };
}
