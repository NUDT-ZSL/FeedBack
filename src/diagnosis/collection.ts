/**
 * 四诊采集层：负责把多次采集的记录整理成冲突视图与解析后输入。
 * 原则：重复采集不覆盖，按来源与时刻区分并保留冲突，由使用者裁决后才参与辨证。
 */
import type {
  Adjudication,
  CollectionConflict,
  CollectionRecord,
  ResolvedFinding,
  ResolvedInputs,
} from './types';

export function sortRecords(records: CollectionRecord[]): CollectionRecord[] {
  return [...records].sort((a, b) =>
    a.recordedAt !== b.recordedAt
      ? a.recordedAt - b.recordedAt
      : a.seq !== b.seq
        ? a.seq - b.seq
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  );
}

const recordKey = (r: Pick<CollectionRecord, 'kind' | 'key'>) => `${r.kind}:${r.key}`;

/**
 * 汇总冲突：同一 kind+key 下出现两个及以上不同取值即构成冲突。
 * 返回按 kind/key 稳定排序的冲突列表。
 */
export function collectConflicts(
  records: CollectionRecord[],
  adjudications: Adjudication[] = [],
): CollectionConflict[] {
  const groups = new Map<string, CollectionRecord[]>();
  for (const record of records) {
    const groupKey = recordKey(record);
    const list = groups.get(groupKey) ?? [];
    list.push(record);
    groups.set(groupKey, list);
  }
  const pickMap = new Map<string, string>();
  const ignoreSet = new Set<string>();
  for (const adj of adjudications) {
    const groupKey = `${adj.kind}:${adj.key}`;
    if (adj.decision === 'pick') pickMap.set(groupKey, adj.recordId);
    else ignoreSet.add(groupKey);
  }
  const conflicts: CollectionConflict[] = [];
  for (const [groupKey, list] of groups) {
    const distinctValues = new Set(list.map((r) => r.value));
    if (distinctValues.size < 2) continue;
    const sorted = sortRecords(list);
    const sep = groupKey.indexOf(':');
    conflicts.push({
      kind: groupKey.slice(0, sep) as CollectionConflict['kind'],
      key: groupKey.slice(sep + 1),
      records: sorted,
      resolvedRecordId: ignoreSet.has(groupKey)
        ? null
        : (pickMap.get(groupKey) ?? null),
    });
  }
  return conflicts.sort((a, b) =>
    a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
}

/**
 * 解析输入：对每个采集项确定唯一生效取值。
 * - 无冲突：取该 key 下按时刻排序后的唯一取值（取值一致时取最早一条记录作为来源）。
 * - 有冲突且已裁决 pick：取被裁决记录。
 * - 有冲突且裁决 ignore：该项不参与辨证。
 * - 有冲突未裁决：不参与辨证（冲突会在结果中显式暴露，绝不静默用后者覆盖前者）。
 */
export function resolveInputs(
  records: CollectionRecord[],
  adjudications: Adjudication[] = [],
): ResolvedInputs {
  const conflicts = collectConflicts(records, adjudications);
  const conflictByGroup = new Map(conflicts.map((c) => [`${c.kind}:${c.key}`, c]));
  const findings: Record<string, ResolvedFinding> = {};

  const groups = new Map<string, CollectionRecord[]>();
  for (const record of records) {
    const groupKey = recordKey(record);
    const list = groups.get(groupKey) ?? [];
    list.push(record);
    groups.set(groupKey, list);
  }

  const pickMap = new Map<string, string>();
  const ignoreSet = new Set<string>();
  for (const adj of adjudications) {
    const groupKey = `${adj.kind}:${adj.key}`;
    if (adj.decision === 'pick') pickMap.set(groupKey, adj.recordId);
    else ignoreSet.add(groupKey);
  }

  for (const [groupKey, list] of groups) {
    const conflict = conflictByGroup.get(groupKey);
    if (conflict) {
      if (ignoreSet.has(groupKey)) continue;
      const pickedId = pickMap.get(groupKey);
      if (!pickedId) continue; // 未裁决：挂起，不进入辨证
      const picked = list.find((r) => r.id === pickedId);
      if (!picked) continue;
      const sep = groupKey.indexOf(':');
      findings[groupKey] = {
        kind: groupKey.slice(0, sep) as ResolvedFinding['kind'],
        key: groupKey.slice(sep + 1),
        value: picked.value,
        sourceRecordId: picked.id,
      };
      continue;
    }
    const sorted = sortRecords(list);
    const first = sorted[0];
    const sep = groupKey.indexOf(':');
    findings[groupKey] = {
      kind: groupKey.slice(0, sep) as ResolvedFinding['kind'],
      key: groupKey.slice(sep + 1),
      value: first.value,
      sourceRecordId: first.id,
    };
  }

  const active = (kind: ResolvedFinding['kind']) =>
    Object.values(findings)
      .filter((f) => f.kind === kind && f.value !== 'false' && f.value !== 'none')
      .map((f) => f.key)
      .sort();

  return {
    findings,
    symptoms: active('symptom'),
    pulses: active('pulse'),
    tongues: active('tongue'),
    constitutions: active('constitution'),
    histories: active('history'),
  };
}
