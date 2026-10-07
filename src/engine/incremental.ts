import {
  Adjudication,
  EventDecision,
  NormEvent,
  SimConfig,
} from "./types";
import { ResumePoint, runSimulation, SimOutput, Snapshot } from "./simulate";
import { BacklogSample, SwitchRecord } from "./types";

/**
 * 变更类型提示：用于确定增量重推的最早受影响时刻。
 * 只重推受影响的时间区间与来源，其余部分直接复用快照前缀。
 */
export type ChangeHint =
  | { kind: "sourceRate"; sourceId: string }
  | { kind: "tierThreshold"; tierId: string; newThreshold: number }
  | { kind: "tierRate"; tierId: string }
  | { kind: "adjudicate" };

/**
 * 计算变更最早影响时刻。返回 Infinity 表示该变更不影响已有推演结果。
 */
export function impactStart(
  prev: SimOutput,
  nextEvents: NormEvent[],
  hint: ChangeHint,
): number {
  if (hint.kind === "sourceRate") {
    const old = prev.normEvents
      .filter((e) => e.sourceId === hint.sourceId)
      .sort((a, b) => a.arrivalTime - b.arrivalTime || a.inputIndex - b.inputIndex);
    const neu = nextEvents
      .filter((e) => e.sourceId === hint.sourceId)
      .sort((a, b) => a.arrivalTime - b.arrivalTime || a.inputIndex - b.inputIndex);
    for (let i = 0; i < Math.min(old.length, neu.length); i++) {
      if (old[i].arrivalTime !== neu[i].arrivalTime) {
        return Math.min(old[i].arrivalTime, neu[i].arrivalTime);
      }
    }
    // 事件集合本身发生增减：从该来源首个事件时刻开始受影响
    if (old.length !== neu.length) {
      return Math.min(
        old[0]?.arrivalTime ?? Infinity,
        neu[0]?.arrivalTime ?? Infinity,
      );
    }
    return Infinity;
  }

  if (hint.kind === "tierThreshold") {
    // 旧阈值：优先取切换记录中的触发阈值，其次取首个涉及该档位切换前后的记录
    const oldThreshold = (() => {
      const sw = prev.switches.find(
        (s) => s.toTier === hint.tierId || s.fromTier === hint.tierId,
      );
      return sw ? sw.trigger.threshold : Infinity;
    })();
    // 阈值下降会让档位提前激活：从旧序列中首次积压达到 min(旧,新) 阈值的时刻重推
    const cut = Math.min(oldThreshold, hint.newThreshold);
    const firstHit = prev.series.find((s) => s.total >= cut);
    return firstHit ? firstHit.time : Infinity;
  }

  if (hint.kind === "tierRate") {
    const activated = prev.switches.find((sw) => sw.toTier === hint.tierId);
    return activated ? activated.time : Infinity;
  }

  // 人工裁决：保守地从首个档位切换时刻（或时间轴起点）重推
  return prev.switches[0]?.time ?? prev.series[0]?.time ?? 0;
}

/**
 * 选择严格早于 impactStart 的最新快照（保证快照处理完的批次不包含任何受影响事件）。
 */
export function selectSnapshot(
  snapshots: Snapshot[],
  start: number,
): Snapshot | null {
  let best: Snapshot | null = null;
  for (const s of snapshots) {
    if (s.time < start && (!best || s.time > best.time)) best = s;
  }
  return best;
}

/**
 * 增量重推：复用快照前缀，仅从受影响断点继续推进。
 * 返回结果与整体重推（runSimulation 全量）逐字段等价，可由 verifyEquivalence 核对。
 */
export function rederive(
  prev: SimOutput,
  nextEvents: NormEvent[],
  nextConfig: SimConfig,
  hint: ChangeHint,
  adjudications: Adjudication[] = [],
): { output: SimOutput; resumedFrom: Snapshot | null; start: number } {
  const start = impactStart(prev, nextEvents, hint);
  const snap = Number.isFinite(start) ? selectSnapshot(prev.snapshots, start) : null;
  if (!snap) {
    const output = runSimulation(nextEvents, nextConfig, adjudications);
    output.issues = prev.issues;
    return { output, resumedFrom: null, start };
  }

  const provisional = new Set(snap.provisionalIds);
  const inputIndex = new Map(
    prev.normEvents.map((e, idx) => [e.id, idx]),
  );
  const decisions = new Map<string, EventDecision>();
  for (const d of prev.events) {
    const idx = inputIndex.get(d.eventId);
    if (idx === undefined) continue;
    if (idx < snap.arrivalIdx && !provisional.has(d.eventId)) {
      decisions.set(d.eventId, { ...d, history: d.history ? [...d.history] : undefined });
    }
  }
  const stripRange = (sw: SwitchRecord) => {
    const { range: _range, ...raw } = sw;
    void _range;
    return { ...raw, effects: { ...raw.effects, trimmedEventIds: [...raw.effects.trimmedEventIds] } };
  };
  const switches = prev.switches
    .slice(0, snap.switchCount)
    .map(stripRange);
  const series: BacklogSample[] = prev.series
    .slice(0, snap.seriesLength)
    .map((s) => ({ ...s, perSource: { ...s.perSource } }));

  const resume: ResumePoint = { snapshot: snap, decisions, switches, series };
  const output = runSimulation(nextEvents, nextConfig, adjudications, undefined, resume);
  output.issues = prev.issues;
  return { output, resumedFrom: snap, start };
}
