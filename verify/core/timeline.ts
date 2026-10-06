/**
 * 回放时间线构建与矛盾记录识别：
 *  - 同一对象同一时刻的记录聚合为一个时间线条目；
 *  - 不同 state 构成矛盾（ConflictGroup），裁决前双方 state 全部保留；
 *  - 裁决后条目只保留胜方记录的 state；
 *  - 同一 state 的重复记录视为幂等观测，不构成矛盾。
 */
import type { ConflictGroup, ImportResult, TimelineEntry } from './types.ts';

export interface BuiltTimelines {
  timelines: Record<string, TimelineEntry[]>;
  conflicts: Record<string, ConflictGroup>;
}

export function buildTimelines(
  imported: ImportResult,
  adjudications: ReadonlyMap<string, string | null> = new Map(),
): BuiltTimelines {
  const byKey = new Map<string, { objectId: string; timestamp: number; records: ImportResult['records'] extends Map<string, infer R> ? R[] : never }>();
  for (const record of imported.records.values()) {
    const key = `${record.objectId}\u0000${record.timestamp}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.records.push(record);
    else byKey.set(key, { objectId: record.objectId, timestamp: record.timestamp, records: [record] });
  }

  const timelines: Record<string, TimelineEntry[]> = {};
  const conflicts: Record<string, ConflictGroup> = {};

  for (const [key, bucket] of byKey) {
    const records = bucket.records.slice().sort((a, b) => a.id.localeCompare(b.id));
    const distinctStates = [...new Set(records.map((r) => r.state))].sort();
    const conflictKey = key.replace('\u0000', '@');
    const isConflict = distinctStates.length > 1;
    const winnerId = adjudications.get(conflictKey) ?? null;

    if (isConflict && !winnerId) {
      conflicts[conflictKey] = {
        objectId: bucket.objectId,
        timestamp: bucket.timestamp,
        recordIds: records.map((r) => r.id),
        states: distinctStates,
        resolved: false,
        winnerId: null,
      };
    } else if (isConflict) {
      conflicts[conflictKey] = {
        objectId: bucket.objectId,
        timestamp: bucket.timestamp,
        recordIds: records.map((r) => r.id),
        states: distinctStates,
        resolved: true,
        winnerId,
      };
    }

    const states = winnerId
      ? [imported.records.get(winnerId)!.state]
      : distinctStates;
    const entry: TimelineEntry = { timestamp: bucket.timestamp, states, adjudicated: winnerId };
    (timelines[bucket.objectId] ??= []).push(entry);
  }

  for (const objectId of Object.keys(timelines)) {
    timelines[objectId].sort((a, b) => a.timestamp - b.timestamp);
  }
  return { timelines, conflicts };
}
