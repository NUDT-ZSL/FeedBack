/**
 * 单场次编排核心（纯函数）。
 *
 * 这是编排规则、冲突判定与排序语义的唯一实现：
 * 多场次 Store 对每场次的重推、批量入口的一致性校验，都复用本模块，
 * 以保证“同一份输入下，多场次各自的结果与原先单场单独编排一致”。
 */
import type {
  Assignment,
  BookingRequest,
  Participant,
  Rejection,
  ResourceItem,
  Session,
  SessionConflict,
  SessionResult,
  TimeSlot,
} from './types';

export interface SessionInput {
  session: Session;
  slots: TimeSlot[];
  requests: BookingRequest[];
  participants: Record<string, Participant>;
  resources: Record<string, ResourceItem>;
}

/** 稳定序列化（键序固定），用于结果摘要与一致性比对 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/** FNV-1a 32 位哈希，输出 8 位十六进制摘要 */
export function digestOf(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

interface Usage {
  assignmentId: string;
  slotId: string;
  start: number;
  end: number;
}

/** 把互相重叠（传递闭包）的占用合并成组，组间互不重叠 */
function groupOverlapping(usages: Usage[]): Usage[][] {
  const sorted = [...usages].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.assignmentId.localeCompare(b.assignmentId),
  );
  const groups: Usage[][] = [];
  let current: Usage[] = [];
  let currentEnd = -Infinity;
  for (const usage of sorted) {
    if (current.length === 0 || usage.start < currentEnd) {
      current.push(usage);
      currentEnd = Math.max(currentEnd, usage.end);
    } else {
      groups.push(current);
      current = [usage];
      currentEnd = usage.end;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** 扫描线求组内峰值并发数 */
function peakConcurrency(group: Usage[]): number {
  const events: Array<{ at: number; delta: number }> = [];
  for (const usage of group) {
    events.push({ at: usage.start, delta: 1 });
    events.push({ at: usage.end, delta: -1 });
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) {
    active += event.delta;
    if (active > peak) peak = active;
  }
  return peak;
}

/** 对某一实体（资源项或参与者）在场次内的占用做冲突判定 */
function detectEntityConflicts(
  type: SessionConflict['type'],
  entityId: string,
  sessionId: string,
  usages: Usage[],
  capacity: number,
): SessionConflict[] {
  const conflicts: SessionConflict[] = [];
  for (const group of groupOverlapping(usages)) {
    if (group.length < 2) continue;
    if (peakConcurrency(group) <= capacity) continue;
    const assignmentIds = group.map((u) => u.assignmentId).sort();
    const slotIds: string[] = [];
    for (const usage of group) {
      if (!slotIds.includes(usage.slotId)) slotIds.push(usage.slotId);
    }
    conflicts.push({
      id: `cf-${type}-${entityId}-${conflicts.length}`,
      type,
      sessionId,
      entityId,
      assignmentIds,
      slotIds,
    });
  }
  return conflicts;
}

/**
 * 单场次编排：校验请求 → 落位排序 → 冲突判定。
 *
 * 规则（必须保持不变的语义）：
 * 1. 校验：时段须属于本场次；参与者、资源项须存在于共享池；
 *    requiredKind 与资源项 kind 不符则拒绝。被拒请求进入 rejections，不保留失效引用。
 * 2. 排序：按（时段 start，时段 id，priority，请求 id）升序，序号从 0 连续编号。
 * 3. 冲突：同一资源项并发占用超过 capacity 记 resource-overlap；
 *    同一参与者同时段重叠记 participant-overlap（容量恒为 1）。
 */
export function orchestrateSession(input: SessionInput): SessionResult {
  const { session, requests, participants, resources } = input;
  const slots = input.slots.filter((slot) => slot.sessionId === session.id);
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));

  const accepted: Array<{ request: BookingRequest; slot: TimeSlot }> = [];
  const rejections: Rejection[] = [];

  for (const request of requests) {
    const slot = slotById.get(request.slotId);
    if (!slot) {
      rejections.push({
        requestId: request.id,
        sessionId: session.id,
        reason: 'unknown-slot',
        detail: `时段 ${request.slotId} 不属于场次 ${session.id}`,
      });
      continue;
    }
    if (!participants[request.participantId]) {
      rejections.push({
        requestId: request.id,
        sessionId: session.id,
        reason: 'unknown-participant',
        detail: `参与者 ${request.participantId} 不在共享池中`,
      });
      continue;
    }
    const resource = resources[request.resourceId];
    if (!resource) {
      rejections.push({
        requestId: request.id,
        sessionId: session.id,
        reason: 'unknown-resource',
        detail: `资源项 ${request.resourceId} 不在共享池中`,
      });
      continue;
    }
    if (request.requiredKind !== undefined && resource.kind !== request.requiredKind) {
      rejections.push({
        requestId: request.id,
        sessionId: session.id,
        reason: 'kind-mismatch',
        detail: `资源项 ${request.resourceId} 类型 ${resource.kind} 不满足约束 ${request.requiredKind}`,
      });
      continue;
    }
    accepted.push({ request, slot });
  }

  accepted.sort((a, b) => {
    return (
      a.slot.start - b.slot.start ||
      a.slot.id.localeCompare(b.slot.id) ||
      a.request.priority - b.request.priority ||
      a.request.id.localeCompare(b.request.id)
    );
  });

  const assignments: Assignment[] = accepted.map(({ request }, index) => ({
    id: `asg-${request.id}`,
    requestId: request.id,
    sessionId: session.id,
    participantId: request.participantId,
    resourceId: request.resourceId,
    slotId: request.slotId,
    order: index,
  }));

  const slotOf = (assignment: Assignment): TimeSlot => slotById.get(assignment.slotId)!;
  const toUsage = (assignment: Assignment): Usage => ({
    assignmentId: assignment.id,
    slotId: assignment.slotId,
    start: slotOf(assignment).start,
    end: slotOf(assignment).end,
  });

  const usagesByResource = new Map<string, Usage[]>();
  const usagesByParticipant = new Map<string, Usage[]>();
  for (const assignment of assignments) {
    const usage = toUsage(assignment);
    const resourceUsages = usagesByResource.get(assignment.resourceId) ?? [];
    resourceUsages.push(usage);
    usagesByResource.set(assignment.resourceId, resourceUsages);
    const participantUsages = usagesByParticipant.get(assignment.participantId) ?? [];
    participantUsages.push(usage);
    usagesByParticipant.set(assignment.participantId, participantUsages);
  }

  const conflicts: SessionConflict[] = [];
  for (const [resourceId, usages] of usagesByResource) {
    const capacity = Math.max(1, resources[resourceId]?.capacity ?? 1);
    conflicts.push(
      ...detectEntityConflicts('resource-overlap', resourceId, session.id, usages, capacity),
    );
  }
  for (const [participantId, usages] of usagesByParticipant) {
    conflicts.push(
      ...detectEntityConflicts('participant-overlap', participantId, session.id, usages, 1),
    );
  }
  conflicts.sort((a, b) => a.entityId.localeCompare(b.entityId) || a.id.localeCompare(b.id));

  const result: SessionResult = {
    sessionId: session.id,
    assignments,
    rejections,
    conflicts,
    digest: '',
  };
  result.digest = digestOf({ assignments, rejections, conflicts });
  return result;
}
