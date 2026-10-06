import { canonicalizeVerdict } from './canonical.ts';
import type {
  Adjudication,
  Anomaly,
  Dataset,
  EventImpact,
  KeyEvent,
  ObjectStateEntry,
  ReplayVerdict,
  SpatialRecord,
} from './types.ts';

const byAtThenId = <T extends { at: number; id: string }>(a: T, b: T): number =>
  a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function conflictIdOf(slot: { objectId: string; at: number; key: string }): string {
  return `${slot.objectId}|${slot.at}|${slot.key}`;
}

/**
 * 记录修正解析：被 corrects 指向的旧记录退出有效集（双方都保留在原始输入中），
 * 指向缺失记录时产生 correction-target-missing 异常而非静默忽略。
 */
export function resolveCorrections(records: SpatialRecord[]): {
  records: SpatialRecord[];
  anomalies: Anomaly[];
} {
  const byIdMap = new Map(records.map((r) => [r.id, r]));
  const superseded = new Set<string>();
  const anomalies: Anomaly[] = [];
  for (const r of records) {
    if (r.corrects === undefined) continue;
    if (byIdMap.has(r.corrects)) {
      superseded.add(r.corrects);
    } else {
      anomalies.push({
        type: 'correction-target-missing',
        recordId: r.id,
        missingRecordId: r.corrects,
      });
    }
  }
  return {
    records: records.filter((r) => !superseded.has(r.id)),
    anomalies,
  };
}

/**
 * 矛盾裁决：同一 (objectId, at, key) 出现不同值即构成矛盾，双方记录都保留；
 * 有裁决时按裁决取值，无裁决时产生 unresolved-conflict 异常并以确定性的
 * 最小记录 id 兜底（兜底行为本身也写入异常，可被观察）。
 */
export function resolveConflicts(
  records: SpatialRecord[],
  adjudications: Adjudication[],
): { winners: SpatialRecord[]; anomalies: Anomaly[]; conflictIds: string[] } {
  const adjudicationMap = new Map(adjudications.map((a) => [a.conflictId, a.winnerRecordId]));
  const groups = new Map<string, SpatialRecord[]>();
  for (const r of records) {
    const id = conflictIdOf(r);
    const group = groups.get(id);
    if (group) group.push(r);
    else groups.set(id, [r]);
  }
  const winners: SpatialRecord[] = [];
  const anomalies: Anomaly[] = [];
  const conflictIds: string[] = [];
  for (const [conflictId, group] of groups) {
    const distinctValues = new Set(group.map((r) => String(r.value)));
    if (distinctValues.size <= 1) {
      winners.push(group.slice().sort(byId)[0]);
      continue;
    }
    conflictIds.push(conflictId);
    const winnerId = adjudicationMap.get(conflictId);
    const chosen = winnerId === undefined ? undefined : group.find((r) => r.id === winnerId);
    if (chosen) {
      winners.push(chosen);
    } else {
      const fallback = group.slice().sort(byId)[0];
      anomalies.push({
        type: 'unresolved-conflict',
        conflictId,
        candidateRecordIds: group.map((r) => r.id).sort(),
        fallbackRecordId: fallback.id,
      });
      winners.push(fallback);
    }
  }
  winners.sort(byAtThenId);
  conflictIds.sort();
  return { winners, anomalies, conflictIds };
}

/** 由生效记录序列计算对象状态（每个键保留来源记录 id 作为判定依据）。 */
export function computeObjectStates(
  winners: SpatialRecord[],
): Record<string, Record<string, ObjectStateEntry>> {
  const states: Record<string, Record<string, ObjectStateEntry>> = {};
  for (const r of winners) {
    (states[r.objectId] ??= {})[r.key] = { value: r.value, recordId: r.id };
  }
  return states;
}

/**
 * 事件依赖分析：依赖指向缺失事件 → missing-dependency 异常；
 * 依赖成环 → dependency-cycle 异常。涉事事件从影响计算中剔除，
 * 但异常会进入结论，绝不静默跳过。
 */
export function analyzeEvents(events: KeyEvent[]): { valid: KeyEvent[]; anomalies: Anomaly[] } {
  const sorted = events.slice().sort(byAtThenId);
  const ids = new Set(sorted.map((e) => e.id));
  const anomalies: Anomaly[] = [];
  const invalid = new Set<string>();
  for (const e of sorted) {
    for (const dep of e.dependsOn) {
      if (!ids.has(dep)) {
        anomalies.push({ type: 'missing-dependency', eventId: e.id, missingEventId: dep });
        invalid.add(e.id);
      }
    }
  }
  const edges = new Map<string, string[]>(
    sorted.map((e) => [e.id, e.dependsOn.filter((d) => ids.has(d))]),
  );
  for (const cycle of findCycles(edges)) {
    anomalies.push({ type: 'dependency-cycle', eventIds: cycle });
    for (const id of cycle) invalid.add(id);
  }
  return { valid: sorted.filter((e) => !invalid.has(e.id)), anomalies };
}

/** 反复做三色 DFS，找出一个环就记录其成员并移除，直到无环。 */
function findCycles(edges: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const remaining = new Map([...edges].map(([k, v]) => [k, [...v]]));
  for (;;) {
    const color = new Map<string, 'gray' | 'black'>();
    const stack: string[] = [];
    let found: string[] | undefined;
    const visit = (id: string): void => {
      if (found) return;
      color.set(id, 'gray');
      stack.push(id);
      for (const next of remaining.get(id) ?? []) {
        if (found) return;
        const c = color.get(next);
        if (c === 'gray') {
          found = stack.slice(stack.indexOf(next)).sort();
          return;
        }
        if (c !== 'black') visit(next);
      }
      stack.pop();
      color.set(id, 'black');
    };
    for (const id of [...remaining.keys()].sort()) {
      if (!color.has(id)) visit(id);
      if (found) break;
    }
    if (!found) return cycles;
    cycles.push(found);
    for (const id of found) remaining.delete(id);
    for (const [, deps] of remaining) {
      for (let i = deps.length - 1; i >= 0; i--) {
        if (found.includes(deps[i])) deps.splice(i, 1);
      }
    }
  }
}

/** 计算单个有效事件的影响范围。 */
export function computeEventImpact(
  event: KeyEvent,
  allEvents: KeyEvent[],
  winners: SpatialRecord[],
): EventImpact {
  const [start, end] = event.window;
  const touchedKeys = [
    ...new Set(
      winners
        .filter((r) => r.objectId === event.objectId && r.at >= start && r.at <= end)
        .map((r) => r.key),
    ),
  ].sort();
  const byIdMap = new Map(allEvents.map((e) => [e.id, e]));
  const reachableObjects = new Set<string>();
  const queue = [event.id];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const current = byIdMap.get(queue.shift() as string);
    if (!current) continue;
    reachableObjects.add(current.objectId);
    for (const dep of current.dependsOn) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return {
    objectId: event.objectId,
    window: event.window,
    touchedKeys,
    reachableObjects: [...reachableObjects].sort(),
  };
}

/** 全量回放：对导入顺序不敏感（内部统一规范化排序），输出可比较的判定结论。 */
export function replay(dataset: Dataset): ReplayVerdict {
  const { records: effective, anomalies: correctionAnomalies } = resolveCorrections(dataset.records);
  const { winners, anomalies: conflictAnomalies } = resolveConflicts(
    effective,
    dataset.adjudications,
  );
  const { valid, anomalies: eventAnomalies } = analyzeEvents(dataset.events);
  const eventImpacts: Record<string, EventImpact> = {};
  for (const e of valid) {
    eventImpacts[e.id] = computeEventImpact(e, dataset.events, winners);
  }
  return canonicalizeVerdict({
    objectStates: computeObjectStates(winners),
    eventImpacts,
    anomalies: [...correctionAnomalies, ...conflictAnomalies, ...eventAnomalies],
  });
}
