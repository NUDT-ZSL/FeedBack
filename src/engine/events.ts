import type {
  AdjudicationAction,
  ConflictGroup,
  EventSet,
  StreamEvent,
} from './types';

function eventFingerprint(e: StreamEvent): string {
  return [e.size, e.kind ?? '', e.payload ?? ''].join('|');
}

function conflictKey(source: string, timestamp: number): string {
  return `${source}@${timestamp}`;
}

/**
 * 由原始事件列表构造事件集合：
 * - 同一来源同一时刻出现多条事件时全部保留，不静默择一；
 * - 内容完全一致标 duplicate（重复），否则标 conflict（冲突）；
 * - 新出现的组一律 pending（待裁决）。
 * 已存在集合上的裁决结果按 key 保留。
 */
export function createEventSet(
  events: StreamEvent[],
  prev?: EventSet,
): EventSet {
  const sorted = [...events].sort(
    (a, b) => a.timestamp - b.timestamp || a.source.localeCompare(b.source) || a.id.localeCompare(b.id),
  );

  const groups = new Map<string, StreamEvent[]>();
  for (const event of sorted) {
    const key = conflictKey(event.source, event.timestamp);
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }

  const conflicts: ConflictGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const first = eventFingerprint(list[0]);
    const kind: ConflictGroup['kind'] = list.every(
      (event) => eventFingerprint(event) === first,
    )
      ? 'duplicate'
      : 'conflict';

    const old = prev?.conflicts.find((group) => group.key === key);
    conflicts.push({
      key,
      source: list[0].source,
      timestamp: list[0].timestamp,
      kind,
      eventIds: list.map((event) => event.id),
      status: old?.status ?? 'pending',
      resolution: old?.resolution,
    });
  }

  const version = prev ? prev.version + 1 : 0;
  return { version, events: sorted, conflicts };
}

/** 对某个重复/冲突组进行裁决，事件集合版本号 +1 */
export function adjudicate(
  set: EventSet,
  key: string,
  action: AdjudicationAction,
): EventSet {
  return {
    ...set,
    version: set.version + 1,
    conflicts: set.conflicts.map((group) =>
      group.key === key ? { ...group, status: 'resolved' as const, resolution: action } : group,
    ),
  };
}

/** 当前被准入参与积压推算的事件 id：待裁决组中的事件全部排除；已裁决按裁决结果排除 */
export function admittedEventIds(set: EventSet): Set<string> {
  const admitted = new Set(set.events.map((event) => event.id));
  for (const group of set.conflicts) {
    if (group.status === 'pending') {
      for (const id of group.eventIds) admitted.delete(id);
    } else if (group.resolution?.type === 'keep') {
      for (const id of group.eventIds) {
        if (id !== group.resolution.eventId) admitted.delete(id);
      }
    } else if (group.resolution?.type === 'dropAll') {
      for (const id of group.eventIds) admitted.delete(id);
    }
  }
  return admitted;
}

/** 事件当前状态（用于界面展示） */
export function eventStatus(
  set: EventSet,
  eventId: string,
): 'normal' | 'pending' | 'dropped' {
  for (const group of set.conflicts) {
    if (!group.eventIds.includes(eventId)) continue;
    if (group.status === 'pending') return 'pending';
    if (group.resolution?.type === 'dropAll') return 'dropped';
    if (group.resolution?.type === 'keep' && group.resolution.eventId !== eventId) {
      return 'dropped';
    }
  }
  return 'normal';
}

export function conflictByEvent(set: EventSet, eventId: string): ConflictGroup | undefined {
  return set.conflicts.find((group) => group.eventIds.includes(eventId));
}
