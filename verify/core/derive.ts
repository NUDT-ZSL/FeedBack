/**
 * 事件关联推导：沿清洗后的记录依赖边做闭包传播，
 * 得到每个关键事件的影响对象集合与回放时间区间。
 * 推导只沿有效边传播（缺失 / 自引用 / 成环边已在导入阶段剔除并归因）。
 */
import type { EventImpact, ImportResult } from './types.ts';

/** 从一组起始记录出发，沿 dependsOn 边求可达闭包（含自身）。 */
export function dependencyClosure(imported: ImportResult, seedIds: string[]): Set<string> {
  const reached = new Set<string>();
  const queue = [...new Set(seedIds)].filter((id) => imported.records.has(id));
  while (queue.length) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const dep of imported.edges.get(id) ?? []) {
      if (!reached.has(dep)) queue.push(dep);
    }
  }
  return reached;
}

export interface DerivedEvent {
  impact: EventImpact;
  /** 推导命中的记录集合，供局部重推算子定位范围。 */
  recordClosure: Set<string>;
}

/** 推导单个事件的影响范围（撤回事件返回 withdrawn=true 的空范围）。 */
export function deriveEventImpact(imported: ImportResult, eventId: string, withdrawn = false): DerivedEvent {
  const event = imported.events.get(eventId);
  if (!event) {
    throw new Error(`deriveEventImpact: 事件 ${eventId} 不存在`);
  }
  const directRecords = (event.linkedRecordIds ?? []).filter((id) => imported.records.has(id));
  const directObjects = (event.linkedObjectIds ?? [])
    .filter((oid) => new Set([...imported.records.values()].map((r) => r.objectId)).has(oid));
  const closure = dependencyClosure(imported, directRecords);

  const objectSet = new Set<string>(directObjects);
  const timestamps: number[] = [];
  for (const id of closure) {
    const record = imported.records.get(id)!;
    objectSet.add(record.objectId);
    timestamps.push(record.timestamp);
  }
  for (const oid of directObjects) {
    for (const record of imported.records.values()) {
      if (record.objectId === oid) timestamps.push(record.timestamp);
    }
  }
  timestamps.push(event.timestamp);

  return {
    recordClosure: closure,
    impact: {
      eventId,
      objectIds: [...objectSet].sort(),
      interval: timestamps.length
        ? { start: Math.min(...timestamps), end: Math.max(...timestamps) }
        : { start: event.timestamp, end: event.timestamp },
      derivedFromRecords: directRecords.slice().sort(),
      derivedFromObjects: directObjects.slice().sort(),
      withdrawn,
    },
  };
}

/** 全量推导所有事件（可带撤回集合）。 */
export function deriveAllImpacts(
  imported: ImportResult,
  withdrawnIds: ReadonlySet<string> = new Set(),
): Record<string, EventImpact> {
  const out: Record<string, EventImpact> = {};
  for (const id of [...imported.events.keys()].sort()) {
    out[id] = deriveEventImpact(imported, id, withdrawnIds.has(id)).impact;
  }
  return out;
}
