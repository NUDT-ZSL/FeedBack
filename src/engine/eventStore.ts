import type { ConflictGroup, StreamEvent } from './types';

const groupKey = (source: string, time: number) => `${source}@${time}`;

export interface IngestReport {
  added: StreamEvent[];
  /** 本次摄入新形成或追加的冲突组 */
  touchedGroups: ConflictGroup[];
}

/**
 * 事件集合：背压推算的唯一事实来源。
 * 同一来源同一时刻出现多条事件时，双方全部保留并标记为待裁决，
 * 绝不静默丢弃；任何变更都会推进 version，供结论追溯。
 */
export class EventStore {
  private singles = new Map<string, StreamEvent>();
  private groups = new Map<string, ConflictGroup>();
  private byId = new Map<string, StreamEvent>();
  version = 0;

  ingest(events: StreamEvent[]): IngestReport {
    const report: IngestReport = { added: [], touchedGroups: [] };
    for (const event of events) {
      const key = groupKey(event.source, event.time);
      const group = this.groups.get(key);
      if (group) {
        if (group.status === 'resolved') {
          throw new Error(`事件组 ${key} 已裁决，不能再并入新事件`);
        }
        group.events.push(event);
        group.kind = this.classify(group.events);
        report.touchedGroups.push(group);
      } else {
        const existing = this.singles.get(key);
        if (existing) {
          // 同源同时刻第二条事件：两条都保留，转入待裁决组
          this.singles.delete(key);
          const fresh: ConflictGroup = {
            id: key,
            source: event.source,
            time: event.time,
            events: [existing, event],
            kind: this.classify([existing, event]),
            status: 'pending',
          };
          this.groups.set(key, fresh);
          report.touchedGroups.push(fresh);
        } else {
          this.singles.set(key, event);
          report.added.push(event);
        }
      }
      this.byId.set(event.id, event);
    }
    if (events.length > 0) this.version += 1;
    return report;
  }

  /** 裁决：从组内选定一条事件生效，其余保留在组内备查但不参与推算 */
  adjudicate(groupId: string, resolvedEventId: string): void {
    const group = this.groups.get(groupId);
    if (!group) throw new Error(`未知冲突组 ${groupId}`);
    if (group.status === 'resolved') throw new Error(`冲突组 ${groupId} 已裁决`);
    if (!group.events.some((e) => e.id === resolvedEventId)) {
      throw new Error(`事件 ${resolvedEventId} 不属于冲突组 ${groupId}`);
    }
    group.status = 'resolved';
    group.resolvedEventId = resolvedEventId;
    this.version += 1;
  }

  /** 修正事件内容（体积/内容指纹），修正后版本推进，受影响区间需重推 */
  correctEvent(eventId: string, patch: Partial<Pick<StreamEvent, 'size' | 'payload' | 'time'>>): void {
    const event = this.byId.get(eventId);
    if (!event) throw new Error(`未知事件 ${eventId}`);
    Object.assign(event, patch);
    this.version += 1;
  }

  private classify(events: StreamEvent[]): ConflictGroup['kind'] {
    const [first, ...rest] = events;
    const allSame = rest.every((e) => e.payload === first.payload && e.size === first.size);
    return allSame ? 'duplicate' : 'conflict';
  }

  /** 参与推算的事件：无冲突单条 + 已裁决组中被选定的一条；按时刻排序 */
  resolvedEvents(): StreamEvent[] {
    const out: StreamEvent[] = [...this.singles.values()];
    for (const group of this.groups.values()) {
      if (group.status === 'resolved' && group.resolvedEventId) {
        const chosen = group.events.find((e) => e.id === group.resolvedEventId);
        if (chosen) out.push(chosen);
      }
    }
    return out.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  }

  pendingGroups(): ConflictGroup[] {
    return [...this.groups.values()].filter((g) => g.status === 'pending');
  }

  allGroups(): ConflictGroup[] {
    return [...this.groups.values()];
  }

  getEvent(id: string): StreamEvent | undefined {
    return this.byId.get(id);
  }
}
