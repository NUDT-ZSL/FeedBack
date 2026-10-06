import { canonicalizeVerdict } from './canonical.ts';
import {
  analyzeEvents,
  computeEventImpact,
  computeObjectStates,
  resolveConflicts,
  resolveCorrections,
} from './engine.ts';
import type { Anomaly, Dataset, ReplayVerdict, Scope } from './types.ts';

function maxTick(dataset: Dataset): number {
  let max = 0;
  for (const r of dataset.records) max = Math.max(max, r.at);
  for (const e of dataset.events) max = Math.max(max, e.window[1]);
  return max;
}

/** 裁决影响的范围：矛盾所在对象，从矛盾时刻到数据集末尾的时间区间。 */
export function conflictScope(dataset: Dataset, conflictId: string): Scope {
  const [objectId, atText] = conflictId.split('|');
  return { objectIds: [objectId], timeRange: [Number(atText), maxTick(dataset)] };
}

/** 记录修正影响的范围：被修正记录所在对象，从其时刻到数据集末尾。 */
export function correctionScope(dataset: Dataset, correctionRecordId: string): Scope {
  const correction = dataset.records.find((r) => r.id === correctionRecordId);
  if (!correction) throw new Error(`unknown correction record: ${correctionRecordId}`);
  const target =
    correction.corrects === undefined
      ? undefined
      : dataset.records.find((r) => r.id === correction.corrects);
  const anchor = target ?? correction;
  return { objectIds: [anchor.objectId], timeRange: [anchor.at, maxTick(dataset)] };
}

function isRecordAnomalyInScope(anomaly: Anomaly, dataset: Dataset, scope: Scope): boolean {
  const [start, end] = scope.timeRange;
  if (anomaly.type === 'unresolved-conflict') {
    const [objectId, atText] = anomaly.conflictId.split('|');
    const at = Number(atText);
    return scope.objectIds.includes(objectId) && at >= start && at <= end;
  }
  if (anomaly.type === 'correction-target-missing') {
    const record = dataset.records.find((r) => r.id === anomaly.recordId);
    return (
      record !== undefined &&
      scope.objectIds.includes(record.objectId) &&
      record.at >= start &&
      record.at <= end
    );
  }
  // 事件结构异常只依赖事件图，与记录值变化无关，不在记录类重推范围内。
  return false;
}

/**
 * 受影响范围重推：只重算范围内的对象状态与事件影响，范围外的结论
 * 从上一版判定结论原样保留。设计上应与同输入的全量 replay 结果一致，
 * 该一致性由验证入口自动断言。
 */
export function rederiveScope(
  prev: ReplayVerdict,
  dataset: Dataset,
  scope: Scope,
): ReplayVerdict {
  const [start, end] = scope.timeRange;
  const { records: effective, anomalies: correctionAnomalies } = resolveCorrections(dataset.records);
  const { winners, anomalies: conflictAnomalies } = resolveConflicts(
    effective,
    dataset.adjudications,
  );

  const objectStates = { ...prev.objectStates };
  for (const objectId of scope.objectIds) {
    // 区间之前的记录不受本次变更影响，但作为状态种子参与计算。
    const scoped = winners.filter((r) => r.objectId === objectId && r.at <= end);
    objectStates[objectId] = computeObjectStates(scoped)[objectId] ?? {};
  }

  const { valid } = analyzeEvents(dataset.events);
  const eventImpacts = { ...prev.eventImpacts };
  for (const e of valid) {
    const overlaps = scope.objectIds.includes(e.objectId) && e.window[1] >= start && e.window[0] <= end;
    if (overlaps) eventImpacts[e.id] = computeEventImpact(e, dataset.events, winners);
  }

  const carried = prev.anomalies.filter((a) => !isRecordAnomalyInScope(a, dataset, scope));
  const fresh = [...correctionAnomalies, ...conflictAnomalies].filter((a) =>
    isRecordAnomalyInScope(a, dataset, scope),
  );
  return canonicalizeVerdict({
    objectStates,
    eventImpacts,
    anomalies: [...carried, ...fresh],
  });
}
