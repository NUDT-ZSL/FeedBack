/**
 * 回放引擎：导入 -> 回放推进 -> 关联推导 -> 矛盾裁决 -> 局部重推。
 *
 * 关键保证（由 verify/cases 下的批量用例验证）：
 *  1. 导入异常全部可追溯，绝不静默跳过；
 *  2. 裁决前矛盾双方保留；裁决后仅对受影响对象与区间做局部重推，
 *     且局部重推结果与整体重推（fullRecompute）逐字节一致；
 *  3. 事件关联修正 / 撤回只更新受影响的回放区间与事件影响范围，
 *     未受影响部分保持引用不变（===）；
 *  4. 结论与导入顺序、批次切分无关。
 */
import { importAll } from './importer.ts';
import { buildTimelines } from './timeline.ts';
import { deriveEventImpact } from './derive.ts';
import type {
  Anomaly,
  EventImpact,
  ImportInput,
  ImportResult,
  ReplayConclusion,
  Scope,
  TimelineEntry,
} from './types.ts';

export interface EngineSnapshot {
  conclusion: ReplayConclusion;
  /** 最近一次局部重推覆盖的 (objectId@timestamp) 键集合。 */
  lastRecomputedKeys: ReadonlySet<string>;
  /** 最近一次局部重推覆盖的对象集合。 */
  lastRecomputedObjects: ReadonlySet<string>;
}

export class ReplayEngine {
  private imported: ImportResult;
  private adjudications = new Map<string, string | null>();
  private withdrawnEvents = new Set<string>();
  private timelines: Record<string, TimelineEntry[]> = {};
  private conflicts: ReplayConclusion['conflicts'] = {};
  private eventImpacts: Record<string, EventImpact> = {};
  private lastKeys = new Set<string>();
  private lastObjects = new Set<string>();

  constructor(batches: ImportInput[]) {
    this.imported = importAll(batches);
    this.recomputeAllInternal();
  }

  get anomalies(): Anomaly[] {
    return this.imported.anomalies;
  }

  /** 回放推进：返回截至 t 的回放结论快照（t 省略则推进到全程）。 */
  advance(t?: number): EngineSnapshot {
    const horizon = t ?? Number.POSITIVE_INFINITY;
    const timelines: Record<string, TimelineEntry[]> = {};
    for (const [objectId, entries] of Object.entries(this.timelines)) {
      const sliced = entries.filter((e) => e.timestamp <= horizon);
      if (sliced.length) timelines[objectId] = sliced;
    }
    const conflicts: ReplayConclusion['conflicts'] = {};
    for (const [key, conflict] of Object.entries(this.conflicts)) {
      if (conflict.timestamp <= horizon) conflicts[key] = conflict;
    }
    const eventImpacts: Record<string, EventImpact> = {};
    for (const [id, impact] of Object.entries(this.eventImpacts)) {
      if (impact.interval.start <= horizon) eventImpacts[id] = impact;
    }
    return {
      conclusion: { timelines, conflicts, eventImpacts, anomalies: this.imported.anomalies },
      lastRecomputedKeys: this.lastKeys,
      lastRecomputedObjects: this.lastObjects,
    };
  }

  /**
   * 矛盾裁决：保留胜方记录，仅对受影响对象与区间做局部重推。
   * 返回受影响范围（对象 + 区间），供调用方核对重推范围是否最小。
   */
  adjudicate(objectId: string, timestamp: number, winnerId: string): Scope {
    const conflictKey = `${objectId}@${timestamp}`;
    const conflict = this.conflicts[conflictKey];
    if (!conflict || conflict.resolved) {
      throw new Error(`adjudicate: ${conflictKey} 不存在未裁决矛盾`);
    }
    if (!conflict.recordIds.includes(winnerId)) {
      throw new Error(`adjudicate: 胜方 ${winnerId} 不在矛盾记录 ${conflict.recordIds.join(',')} 中`);
    }
    this.adjudications.set(conflictKey, winnerId);

    // 受影响范围 = 矛盾所在对象 + 经依赖闭包传播到的对象
    const scope = this.scopeForRecords(conflict.recordIds);
    this.partialRecompute(scope);
    return scope;
  }

  /** 修正事件关联：仅重推该事件新旧影响范围的并集。 */
  correctEventLinks(eventId: string, links: { recordIds?: string[]; objectIds?: string[] }): Scope {
    const event = this.imported.events.get(eventId);
    if (!event) throw new Error(`correctEventLinks: 事件 ${eventId} 不存在`);
    const before = this.eventImpacts[eventId];
    this.imported.events.set(eventId, {
      ...event,
      linkedRecordIds: links.recordIds ?? event.linkedRecordIds ?? [],
      linkedObjectIds: links.objectIds ?? event.linkedObjectIds ?? [],
    });
    const after = this.deriveImpactFor(eventId);

    const scope = this.scopeFromImpacts([before, after]);
    this.partialRecompute(scope, [eventId]);
    return scope;
  }

  /** 撤回事件：影响范围置空，仅重推原受影响区间。 */
  withdrawEvent(eventId: string): Scope {
    if (!this.imported.events.has(eventId)) throw new Error(`withdrawEvent: 事件 ${eventId} 不存在`);
    const before = this.eventImpacts[eventId];
    this.withdrawnEvents.add(eventId);

    const scope = this.scopeFromImpacts([before]);
    this.partialRecompute(scope, [eventId]);
    return scope;
  }

  /** 整体重推：作为局部重推正确性的参照基准。 */
  fullRecompute(): EngineSnapshot {
    const fresh = new ReplayEngine([]);
    fresh.imported = this.imported;
    fresh.adjudications = new Map(this.adjudications);
    fresh.withdrawnEvents = new Set(this.withdrawnEvents);
    fresh.recomputeAllInternal();
    return fresh.advance();
  }

  /** 供用例做“未受影响部分未被改动”的引用相等性检查。 */
  rawState(): { timelines: Record<string, TimelineEntry[]>; eventImpacts: Record<string, EventImpact> } {
    return { timelines: this.timelines, eventImpacts: this.eventImpacts };
  }

  // ---- 内部实现 ----

  /** 统一的事件影响推导：撤回事件的范围一律清空，保证局部/整体路径语义一致。 */
  private deriveImpactFor(eventId: string): EventImpact {
    const derived = deriveEventImpact(this.imported, eventId, this.withdrawnEvents.has(eventId)).impact;
    if (this.withdrawnEvents.has(eventId)) {
      return { ...derived, objectIds: [], interval: { start: 0, end: 0 }, withdrawn: true };
    }
    return derived;
  }

  private recomputeAllInternal(): void {
    const built = buildTimelines(this.imported, this.adjudications);
    this.timelines = built.timelines;
    this.conflicts = built.conflicts;
    this.eventImpacts = {};
    for (const id of [...this.imported.events.keys()].sort()) {
      this.eventImpacts[id] = this.deriveImpactFor(id);
    }
    this.lastKeys = new Set(
      Object.entries(this.timelines).flatMap(([oid, entries]) => entries.map((e) => `${oid}@${e.timestamp}`)),
    );
    this.lastObjects = new Set(Object.keys(this.timelines));
  }

  private scopeForRecords(recordIds: string[]): Scope {
    const closure = new Set<string>();
    const queue = [...recordIds];
    // 正向 + 反向依赖闭包：矛盾记录变化会影响依赖它的记录所覆盖的对象
    const reverse = new Map<string, string[]>();
    for (const [child, parents] of this.imported.edges) {
      for (const parent of parents) (reverse.get(parent) ?? reverse.set(parent, []).get(parent)!).push(child);
    }
    while (queue.length) {
      const id = queue.pop()!;
      if (closure.has(id) || !this.imported.records.has(id)) continue;
      closure.add(id);
      for (const parent of this.imported.edges.get(id) ?? []) queue.push(parent);
      for (const child of reverse.get(id) ?? []) queue.push(child);
    }
    const objectIds = new Set<string>();
    const intervals: Record<string, { start: number; end: number }> = {};
    for (const id of closure) {
      const record = this.imported.records.get(id)!;
      objectIds.add(record.objectId);
      const iv = intervals[record.objectId];
      intervals[record.objectId] = iv
        ? { start: Math.min(iv.start, record.timestamp), end: Math.max(iv.end, record.timestamp) }
        : { start: record.timestamp, end: record.timestamp };
    }
    return { objectIds: [...objectIds].sort(), intervals };
  }

  private scopeFromImpacts(impacts: EventImpact[]): Scope {
    const objectIds = new Set<string>();
    const intervals: Record<string, { start: number; end: number }> = {};
    for (const impact of impacts) {
      for (const oid of impact.objectIds) {
        objectIds.add(oid);
        const iv = intervals[oid];
        intervals[oid] = iv
          ? { start: Math.min(iv.start, impact.interval.start), end: Math.max(iv.end, impact.interval.end) }
          : { ...impact.interval };
      }
    }
    return { objectIds: [...objectIds].sort(), intervals };
  }

  /**
   * 局部重推：只重建 scope 内对象在受影响区间上的时间线条目、
   * 相关矛盾组与指定事件的影响范围；其余状态保持引用不变。
   */
  private partialRecompute(scope: Scope, eventIds: string[] = []): void {
    const rebuilt = buildTimelines(this.imported, this.adjudications);
    const scopeSet = new Set(scope.objectIds);
    const recomputedKeys = new Set<string>();

    for (const objectId of scope.objectIds) {
      const iv = scope.intervals[objectId];
      const freshEntries = (rebuilt.timelines[objectId] ?? []).filter(
        (e) => !iv || (e.timestamp >= iv.start && e.timestamp <= iv.end),
      );
      const existing = this.timelines[objectId] ?? [];
      const kept = existing.filter((e) => iv && (e.timestamp < iv.start || e.timestamp > iv.end));
      this.timelines[objectId] = [...kept, ...freshEntries].sort((a, b) => a.timestamp - b.timestamp);
      for (const e of freshEntries) recomputedKeys.add(`${objectId}@${e.timestamp}`);
    }

    // 矛盾组：仅刷新 scope 内的
    for (const [key, conflict] of Object.entries(rebuilt.conflicts)) {
      if (scopeSet.has(conflict.objectId)) this.conflicts[key] = conflict;
    }
    for (const key of Object.keys(this.conflicts)) {
      if (!rebuilt.conflicts[key] && scopeSet.has(this.conflicts[key].objectId)) {
        delete this.conflicts[key];
      }
    }

    // 事件影响范围：仅重推指定事件
    for (const id of eventIds) {
      this.eventImpacts[id] = this.deriveImpactFor(id);
    }

    this.lastKeys = recomputedKeys;
    this.lastObjects = scopeSet;
  }
}
