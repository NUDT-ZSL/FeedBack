import type {
  Allocation,
  Conflict,
  Pools,
  ResourceItem,
  ScheduleResult,
  SessionSpec,
  TimeSlot,
} from "./types.ts";

export function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

function pickResource(
  grade: number,
  slot: TimeSlot,
  resources: ResourceItem[],
  allocations: Allocation[],
  slotById: Map<string, TimeSlot>,
): { resource: ResourceItem | null; gradeRejected: boolean } {
  let gradeRejected = false;
  for (const resource of resources) {
    if (grade > resource.minGrade) {
      gradeRejected = true;
      continue;
    }
    const busy = allocations.some(
      (allocation) =>
        allocation.resourceId === resource.id &&
        slotsOverlap(slotById.get(allocation.slotId) as TimeSlot, slot),
    );
    if (!busy) {
      return { resource, gradeRejected };
    }
  }
  return { resource: null, gradeRejected };
}

export function scheduleSession(spec: SessionSpec, pools: Pools): ScheduleResult {
  const conflicts: Conflict[] = [];
  const allocations: Allocation[] = [];
  const order: string[] = [];

  const participants = spec.participantIds.filter((id) => {
    if (pools.participants.has(id)) {
      return true;
    }
    conflicts.push({
      sessionId: spec.id,
      type: "missing-participant",
      participantId: id,
      message: `参与者 ${id} 已不在共享池中，场次 ${spec.id} 跳过该引用`,
    });
    return false;
  });

  const resources: ResourceItem[] = [];
  for (const id of spec.resourceIds) {
    const resource = pools.resources.get(id);
    if (resource) {
      resources.push(resource);
    } else {
      conflicts.push({
        sessionId: spec.id,
        type: "missing-resource",
        resourceId: id,
        message: `资源项 ${id} 已不在共享池中，场次 ${spec.id} 跳过该引用`,
      });
    }
  }

  const slotById = new Map(spec.slots.map((slot) => [slot.id, slot]));
  const usedSlots = new Set<string>();

  for (const participantId of participants) {
    const participant = pools.participants.get(participantId);
    if (!participant) {
      continue;
    }
    const slot = spec.slots.find((candidate) => !usedSlots.has(candidate.id));
    if (!slot) {
      conflicts.push({
        sessionId: spec.id,
        type: "slot-exhausted",
        participantId,
        message: `场次 ${spec.id} 时段不足，参与者 ${participantId} 未排入`,
      });
      continue;
    }
    usedSlots.add(slot.id);
    const { resource, gradeRejected } = pickResource(
      participant.grade,
      slot,
      resources,
      allocations,
      slotById,
    );
    if (!resource) {
      conflicts.push({
        sessionId: spec.id,
        type: gradeRejected ? "grade-mismatch" : "resource-unavailable",
        participantId,
        slotId: slot.id,
        message: gradeRejected
          ? `参与者 ${participantId} 品级 ${participant.grade} 无可用资源项匹配`
          : `参与者 ${participantId} 在时段 ${slot.id} 无空闲资源项`,
      });
      continue;
    }
    allocations.push({ participantId, resourceId: resource.id, slotId: slot.id });
    order.push(participantId);
  }

  return { sessionId: spec.id, allocations, order, conflicts };
}
