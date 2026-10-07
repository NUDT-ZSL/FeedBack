import { detectContentions } from "./contention.ts";
import { scheduleSession } from "./schedule.ts";
import type {
  Conflict,
  Participant,
  ResourceItem,
  ScheduleResult,
  SessionSpec,
} from "./types.ts";

interface SessionEntry {
  spec: SessionSpec;
  result: ScheduleResult | null;
  dirty: boolean;
}

function sameParticipant(a: Participant, b: Participant): boolean {
  return a.name === b.name && a.grade === b.grade;
}

function sameResource(a: ResourceItem, b: ResourceItem): boolean {
  return a.name === b.name && a.minGrade === b.minGrade;
}

export class OrchestrationStore {
  private participants = new Map<string, Participant>();
  private resources = new Map<string, ResourceItem>();
  private sessions = new Map<string, SessionEntry>();
  private activeId: string | null = null;

  upsertParticipant(participant: Participant): void {
    const existing = this.participants.get(participant.id);
    if (existing && sameParticipant(existing, participant)) {
      return;
    }
    this.participants.set(participant.id, { ...participant });
    this.markReferencing((spec) => spec.participantIds.includes(participant.id));
  }

  removeParticipant(id: string): void {
    if (!this.participants.delete(id)) {
      return;
    }
    this.markReferencing((spec) => spec.participantIds.includes(id));
  }

  upsertResource(resource: ResourceItem): void {
    const existing = this.resources.get(resource.id);
    if (existing && sameResource(existing, resource)) {
      return;
    }
    this.resources.set(resource.id, { ...resource });
    this.markReferencing((spec) => spec.resourceIds.includes(resource.id));
  }

  removeResource(id: string): void {
    if (!this.resources.delete(id)) {
      return;
    }
    this.markReferencing((spec) => spec.resourceIds.includes(id));
  }

  addSession(spec: SessionSpec): void {
    if (this.sessions.has(spec.id)) {
      throw new Error(`场次 ${spec.id} 已存在`);
    }
    this.sessions.set(spec.id, {
      spec: {
        ...spec,
        participantIds: [...spec.participantIds],
        resourceIds: [...spec.resourceIds],
        slots: spec.slots.map((slot) => ({ ...slot })),
      },
      result: null,
      dirty: true,
    });
    if (this.activeId === null) {
      this.activeId = spec.id;
    }
  }

  removeSession(id: string): boolean {
    if (!this.sessions.delete(id)) {
      return false;
    }
    if (this.activeId === id) {
      const next = this.sessions.keys().next();
      this.activeId = next.done ? null : next.value;
    }
    return true;
  }

  updateSessionSpec(id: string, patch: Partial<Omit<SessionSpec, "id">>): boolean {
    const entry = this.sessions.get(id);
    if (!entry) {
      return false;
    }
    entry.spec = {
      ...entry.spec,
      ...patch,
      id: entry.spec.id,
      participantIds: patch.participantIds
        ? [...patch.participantIds]
        : entry.spec.participantIds,
      resourceIds: patch.resourceIds ? [...patch.resourceIds] : entry.spec.resourceIds,
      slots: patch.slots ? patch.slots.map((slot) => ({ ...slot })) : entry.spec.slots,
    };
    entry.dirty = true;
    return true;
  }

  setActiveSession(id: string): boolean {
    if (!this.sessions.has(id)) {
      return false;
    }
    this.activeId = id;
    return true;
  }

  getActiveSessionId(): string | null {
    return this.activeId;
  }

  listSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  getPools(): { participants: ReadonlyMap<string, Participant>; resources: ReadonlyMap<string, ResourceItem> } {
    return { participants: this.participants, resources: this.resources };
  }

  getSessionSpec(id: string): SessionSpec | null {
    const entry = this.sessions.get(id);
    return entry ? entry.spec : null;
  }

  sync(): string[] {
    const rederived: string[] = [];
    for (const [id, entry] of this.sessions) {
      if (!entry.dirty) {
        continue;
      }
      entry.result = scheduleSession(entry.spec, {
        participants: this.participants,
        resources: this.resources,
      });
      entry.dirty = false;
      rederived.push(id);
    }
    return rederived;
  }

  getResult(id: string): ScheduleResult | null {
    this.sync();
    const entry = this.sessions.get(id);
    return entry ? entry.result : null;
  }

  getActiveResult(): ScheduleResult | null {
    return this.activeId === null ? null : this.getResult(this.activeId);
  }

  getConflicts(sessionId?: string): Conflict[] {
    this.sync();
    const results = new Map<string, ScheduleResult>();
    const specs = new Map<string, SessionSpec>();
    for (const [id, entry] of this.sessions) {
      if (entry.result) {
        results.set(id, entry.result);
      }
      specs.set(id, entry.spec);
    }
    const all: Conflict[] = [];
    for (const result of results.values()) {
      all.push(...result.conflicts);
    }
    all.push(...detectContentions(results, specs));
    if (sessionId === undefined) {
      return all;
    }
    return all.filter((conflict) => conflict.sessionId === sessionId);
  }

  private markReferencing(predicate: (spec: SessionSpec) => boolean): void {
    for (const entry of this.sessions.values()) {
      if (predicate(entry.spec)) {
        entry.dirty = true;
      }
    }
  }
}
