/**
 * 多场次编排 Store。
 *
 * 职责：
 * - 每场次各自持有独立的时段、请求与编排结果，切换场次互不污染；
 * - 跨场次共享的参与者 / 资源池改动后，只重推引用它的场次（增量重推），
 *   未受影响的场次结果保持对象级不变；
 * - 跨场次资源占用冲突按场次归属分别呈现，互不复写。
 *
 * 本模块不依赖任何 UI 框架，可在浏览器与离线脚本（批量入口）中复用。
 */
import { orchestrateSession } from './singleSession';
import type {
  BookingRequest,
  CrossSessionConflict,
  Participant,
  ResourceItem,
  Session,
  SessionResult,
  TimeSlot,
} from './types';

/** 场次私有状态：结果与重推计数都按场次隔离 */
export interface SessionState {
  session: Session;
  slots: TimeSlot[];
  requests: BookingRequest[];
  result: SessionResult;
  /** 该场次被重推的次数；切换场次、无关场次变更都不会使其增长 */
  runVersion: number;
}

export interface SessionSummary {
  session: Session;
  runVersion: number;
  result: SessionResult;
  slotCount: number;
  requestCount: number;
}

export class OrchestrationStore {
  private participants: Record<string, Participant> = {};
  private resources: Record<string, ResourceItem> = {};
  private sessions = new Map<string, SessionState>();
  private activeSessionId: string | null = null;

  constructor(init?: { participants?: Participant[]; resources?: ResourceItem[] }) {
    for (const participant of init?.participants ?? []) {
      this.participants[participant.id] = participant;
    }
    for (const resource of init?.resources ?? []) {
      this.resources[resource.id] = resource;
    }
  }

  // ---------- 场次管理 ----------

  /** 新增（或整体替换）场次定义，并仅对该场次做编排 */
  addSession(session: Session, slots: TimeSlot[], requests: BookingRequest[] = []): SessionState {
    const state: SessionState = {
      session,
      slots: slots.filter((slot) => slot.sessionId === session.id),
      requests: requests.filter((request) => request.sessionId === session.id),
      result: undefined as unknown as SessionResult,
      runVersion: 0,
    };
    this.sessions.set(session.id, state);
    this.repush(session.id);
    if (this.activeSessionId === null) this.activeSessionId = session.id;
    return state;
  }

  /** 删除场次；若删除的是当前场次，激活场次顺延到剩余的第一场 */
  removeSession(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    if (!existed) return false;
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions.keys().next().value ?? null;
    }
    return true;
  }

  /** 切换激活场次：只改指针，不触发任何场次的重排 */
  switchSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.activeSessionId = sessionId;
    return true;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  // ---------- 场次输入 ----------

  /** 整体替换某场次的编排请求，并仅重推该场次 */
  setRequests(sessionId: string, requests: BookingRequest[]): boolean {
    const state = this.sessions.get(sessionId);
    if (!state) return false;
    state.requests = requests.filter((request) => request.sessionId === sessionId);
    this.repush(sessionId);
    return true;
  }

  /** 追加一条编排请求，仅重推该场次 */
  addRequest(sessionId: string, request: BookingRequest): boolean {
    const state = this.sessions.get(sessionId);
    if (!state || request.sessionId !== sessionId) return false;
    state.requests = [...state.requests, request];
    this.repush(sessionId);
    return true;
  }

  // ---------- 共享池（改动按引用关系增量传播） ----------

  upsertParticipant(participant: Participant): string[] {
    this.participants[participant.id] = participant;
    return this.repushReferencing((request) => request.participantId === participant.id);
  }

  removeParticipant(participantId: string): string[] {
    if (!(participantId in this.participants)) return [];
    delete this.participants[participantId];
    return this.repushReferencing((request) => request.participantId === participantId);
  }

  upsertResource(resource: ResourceItem): string[] {
    this.resources[resource.id] = resource;
    return this.repushReferencing((request) => request.resourceId === resource.id);
  }

  removeResource(resourceId: string): string[] {
    if (!(resourceId in this.resources)) return [];
    delete this.resources[resourceId];
    return this.repushReferencing((request) => request.resourceId === resourceId);
  }

  // ---------- 查询 ----------

  getResult(sessionId: string): SessionResult | undefined {
    return this.sessions.get(sessionId)?.result;
  }

  getRunVersion(sessionId: string): number {
    return this.sessions.get(sessionId)?.runVersion ?? 0;
  }

  getSessionState(sessionId: string): Readonly<SessionState> | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): SessionSummary[] {
    return [...this.sessions.values()].map((state) => ({
      session: state.session,
      runVersion: state.runVersion,
      result: state.result,
      slotCount: state.slots.length,
      requestCount: state.requests.length,
    }));
  }

  getParticipants(): Record<string, Participant> {
    return { ...this.participants };
  }

  getResources(): Record<string, ResourceItem> {
    return { ...this.resources };
  }

  /**
   * 跨场次资源占用冲突，按场次归属分别呈现。
   * 返回 Map：sessionId → 归属于该场次的冲突列表；
   * 每个场次的列表是独立数组、独立记录对象，互不复写。
   */
  getCrossSessionConflicts(): Map<string, CrossSessionConflict[]> {
    const attributed = new Map<string, CrossSessionConflict[]>();
    for (const sessionId of this.sessions.keys()) attributed.set(sessionId, []);

    interface UsageRef {
      sessionId: string;
      assignmentId: string;
      slotId: string;
      start: number;
      end: number;
    }
    const usagesByResource = new Map<string, UsageRef[]>();
    for (const state of this.sessions.values()) {
      const slotById = new Map(state.slots.map((slot) => [slot.id, slot]));
      for (const assignment of state.result.assignments) {
        const slot = slotById.get(assignment.slotId);
        if (!slot) continue;
        const usages = usagesByResource.get(assignment.resourceId) ?? [];
        usages.push({
          sessionId: state.session.id,
          assignmentId: assignment.id,
          slotId: slot.id,
          start: slot.start,
          end: slot.end,
        });
        usagesByResource.set(assignment.resourceId, usages);
      }
    }

    for (const [resourceId, usages] of [...usagesByResource.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const sorted = [...usages].sort(
        (a, b) => a.start - b.start || a.end - b.end || a.assignmentId.localeCompare(b.assignmentId),
      );
      // 合并互相重叠（传递闭包）的占用组
      const groups: UsageRef[][] = [];
      let current: UsageRef[] = [];
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

      let groupIndex = 0;
      for (const group of groups) {
        const sessionIds = [...new Set(group.map((usage) => usage.sessionId))].sort();
        if (sessionIds.length < 2) continue;
        const interval = {
          start: Math.min(...group.map((usage) => usage.start)),
          end: Math.max(...group.map((usage) => usage.end)),
        };
        const assignments = group
          .map((usage) => ({
            sessionId: usage.sessionId,
            assignmentId: usage.assignmentId,
            slotId: usage.slotId,
          }))
          .sort(
            (a, b) =>
              a.sessionId.localeCompare(b.sessionId) || a.assignmentId.localeCompare(b.assignmentId),
          );
        // 同一冲突为每个涉事场次各生成一条归属记录
        for (const sessionId of sessionIds) {
          attributed.get(sessionId)!.push({
            id: `xs-${resourceId}-${groupIndex}`,
            resourceId,
            attributedTo: sessionId,
            sessionIds,
            interval,
            assignments,
          });
        }
        groupIndex += 1;
      }
    }
    return attributed;
  }

  getCrossSessionConflictsFor(sessionId: string): CrossSessionConflict[] {
    return this.getCrossSessionConflicts().get(sessionId) ?? [];
  }

  // ---------- 内部 ----------

  /** 重推单个场次：复用单场次编排纯函数，保证语义一致 */
  private repush(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.result = orchestrateSession({
      session: state.session,
      slots: state.slots,
      requests: state.requests,
      participants: this.participants,
      resources: this.resources,
    });
    state.runVersion += 1;
  }

  /** 只重推引用了某个共享实体的场次，返回被重推的场次 id（按加入顺序） */
  private repushReferencing(matches: (request: BookingRequest) => boolean): string[] {
    const affected: string[] = [];
    for (const state of this.sessions.values()) {
      if (state.requests.some(matches)) {
        this.repush(state.session.id);
        affected.push(state.session.id);
      }
    }
    return affected;
  }
}
