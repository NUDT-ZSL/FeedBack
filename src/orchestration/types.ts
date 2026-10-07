export interface Participant {
  id: string;
  name: string;
  grade: number;
}

export interface ResourceItem {
  id: string;
  name: string;
  minGrade: number;
}

export interface TimeSlot {
  id: string;
  startsAt: number;
  endsAt: number;
}

export interface SessionSpec {
  id: string;
  name: string;
  participantIds: string[];
  resourceIds: string[];
  slots: TimeSlot[];
}

export interface Allocation {
  participantId: string;
  resourceId: string;
  slotId: string;
}

export type ConflictType =
  | "grade-mismatch"
  | "resource-unavailable"
  | "slot-exhausted"
  | "missing-participant"
  | "missing-resource"
  | "resource-contention";

export interface Conflict {
  sessionId: string;
  type: ConflictType;
  participantId?: string;
  resourceId?: string;
  slotId?: string;
  otherSessionId?: string;
  message: string;
}

export interface ScheduleResult {
  sessionId: string;
  allocations: Allocation[];
  order: string[];
  conflicts: Conflict[];
}

export interface Pools {
  participants: ReadonlyMap<string, Participant>;
  resources: ReadonlyMap<string, ResourceItem>;
}
