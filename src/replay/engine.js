/**
 * 回放推导段（纯函数）：
 *  - 按对象/时刻归组空间记录，识别“同对象同时刻矛盾状态”，裁决前双方均保留；
 *  - 沿有效关联图推导每个关键事件影响到的记录、对象与时间区间；
 *  - 全部输出按键排序、内容规范化，保证可复现。
 *
 * adjudications: Map<"${objectId}@${timestamp}", winnerRecordId>，
 * 表示外部裁决决定；同一份 dataset + 同一组裁决必然得到同一份报告。
 */

import {
  compareStrings,
  contentHash,
  deepClone,
  mergeIntervals,
  stableStringify,
} from './canonical.js';

/** 时间线条目：同一 objectId + timestamp 下的所有记录归并结果。 */
function buildTimelineForObject(objectId, recordsOfObject, adjudications) {
  const byTimestamp = new Map();
  for (const record of recordsOfObject) {
    if (!byTimestamp.has(record.timestamp)) byTimestamp.set(record.timestamp, []);
    byTimestamp.get(record.timestamp).push(record);
  }
  const entries = [];
  for (const timestamp of [...byTimestamp.keys()].sort((a, b) => a - b)) {
    const group = byTimestamp.get(timestamp).slice().sort((a, b) => compareStrings(a.id, b.id));
    const distinctStates = new Map();
    for (const record of group) {
      const sig = stableStringify(record.state);
      if (!distinctStates.has(sig)) distinctStates.set(sig, []);
      distinctStates.get(sig).push(record);
    }
    const conflictRecords = group.map((r) => ({
      recordId: r.id,
      state: deepClone(r.state),
      priority: r.priority,
    }));

    if (distinctStates.size === 1) {
      entries.push({
        objectId,
        timestamp,
        status: 'ok',
        state: deepClone(group[0].state),
        recordIds: group.map((r) => r.id),
      });
      continue;
    }

    const key = `${objectId}@${timestamp}`;
    const adjudicatedWinner = adjudications?.get(key);
    let status = 'conflicting';
    let state = null;
    let winnerRecordIds = [];

    const maxPriority = Math.max(...group.map((r) => r.priority));
    const priorityWinners = group.filter((r) => r.priority === maxPriority);
    const priorityWinnerSigs = new Set(priorityWinners.map((r) => stableStringify(r.state)));

    if (adjudicatedWinner && group.some((r) => r.id === adjudicatedWinner)) {
      const winner = group.find((r) => r.id === adjudicatedWinner);
      status = 'resolved';
      state = deepClone(winner.state);
      winnerRecordIds = [winner.id];
    } else if (priorityWinnerSigs.size === 1) {
      status = 'resolved';
      state = deepClone(priorityWinners[0].state);
      winnerRecordIds = priorityWinners.map((r) => r.id).sort(compareStrings);
    }

    entries.push({
      objectId,
      timestamp,
      status,
      state,
      winnerRecordIds,
      conflictRecords,
    });
  }
  return entries;
}

/** 沿有效关联做环安全 BFS，返回事件可达记录集合。 */
export function traceEventRecords(dataset, event) {
  const visited = new Set();
  if (event.status === 'withdrawn') return visited;
  const queue = (dataset.validLinks.get(`event:${event.id}`) ?? []).slice();
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    const record = dataset.records.get(id);
    if (!record) continue;
    visited.add(id);
    for (const next of dataset.validLinks.get(id) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function deriveEventScope(dataset, event, visitedRecords) {
  const affectedRecords = [...visitedRecords].sort(compareStrings);
  const objects = new Set();
  const pointIntervals = event.status === 'withdrawn'
    ? []
    : [{ start: event.timestamp, end: event.timestamp }];
  const stateDigestParts = [];
  for (const id of affectedRecords) {
    const record = dataset.records.get(id);
    objects.add(record.objectId);
    pointIntervals.push({ start: record.timestamp, end: record.timestamp });
    stateDigestParts.push(`${id}=${contentHash(record.state)}`);
  }
  return {
    id: event.id,
    timestamp: event.timestamp,
    kind: event.kind,
    status: event.status,
    affectedRecords,
    affectedObjects: [...objects].sort(compareStrings),
    intervals: mergeIntervals(pointIntervals),
    stateDigest: contentHash(stateDigestParts.join('|')),
  };
}

/**
 * 全量推导。adjudications 可选。
 * 返回可直接做内容比较的规范化报告（键已排序、数组已排序）。
 */
export function deriveFullReport(dataset, adjudications = new Map()) {
  const recordsByObject = new Map();
  for (const record of dataset.records.values()) {
    if (!recordsByObject.has(record.objectId)) recordsByObject.set(record.objectId, []);
    recordsByObject.get(record.objectId).push(record);
  }

  const timeline = {};
  const conflicts = [];
  for (const objectId of [...recordsByObject.keys()].sort(compareStrings)) {
    const entries = buildTimelineForObject(objectId, recordsByObject.get(objectId), adjudications);
    timeline[objectId] = entries;
    for (const entry of entries) {
      if (entry.status === 'conflicting') {
        conflicts.push({
          objectId,
          timestamp: entry.timestamp,
          records: entry.conflictRecords,
        });
      }
    }
  }

  const events = [];
  for (const event of [...dataset.events.values()].sort((a, b) => compareStrings(a.id, b.id))) {
    const visited = traceEventRecords(dataset, event);
    events.push(deriveEventScope(dataset, event, visited));
  }

  return {
    anomalies: deepClone(dataset.anomalies),
    timeline,
    conflicts,
    events,
  };
}

/** 报告内容指纹（忽略 anomalies？不——异常归属也是结论的一部分，整体入指纹）。 */
export function reportFingerprint(report) {
  return contentHash(report);
}

/**
 * 按时间推进回放：返回某时刻对象的有效状态。
 * 状态在相邻记录之间持续有效；命中未裁决矛盾时返回 conflicting 描述。
 */
export function stateAt(report, objectId, time) {
  const entries = report.timeline[objectId];
  if (!entries) return { kind: 'unknown' };
  let current = null;
  for (const entry of entries) {
    if (entry.timestamp > time) break;
    current = entry;
  }
  if (!current) return { kind: 'empty' };
  if (current.status === 'conflicting') {
    return {
      kind: 'conflicting',
      timestamp: current.timestamp,
      candidates: current.conflictRecords,
    };
  }
  return { kind: 'state', since: current.timestamp, state: current.state };
}
