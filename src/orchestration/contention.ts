import { slotsOverlap } from "./schedule.ts";
import type { Conflict, ScheduleResult, SessionSpec, TimeSlot } from "./types.ts";

export function detectContentions(
  results: ReadonlyMap<string, ScheduleResult>,
  specs: ReadonlyMap<string, SessionSpec>,
): Conflict[] {
  const conflicts: Conflict[] = [];
  const entries = [...results.values()].sort((a, b) =>
    a.sessionId.localeCompare(b.sessionId),
  );
  const slotCache = new Map<string, Map<string, TimeSlot>>();
  const slotsOf = (sessionId: string): Map<string, TimeSlot> => {
    let slots = slotCache.get(sessionId);
    if (!slots) {
      const spec = specs.get(sessionId);
      slots = new Map((spec ? spec.slots : []).map((slot) => [slot.id, slot]));
      slotCache.set(sessionId, slots);
    }
    return slots;
  };

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const left = entries[i];
      const right = entries[j];
      const leftSlots = slotsOf(left.sessionId);
      const rightSlots = slotsOf(right.sessionId);
      for (const a of left.allocations) {
        for (const b of right.allocations) {
          if (a.resourceId !== b.resourceId) {
            continue;
          }
          const slotA = leftSlots.get(a.slotId);
          const slotB = rightSlots.get(b.slotId);
          if (!slotA || !slotB || !slotsOverlap(slotA, slotB)) {
            continue;
          }
          conflicts.push({
            sessionId: left.sessionId,
            type: "resource-contention",
            resourceId: a.resourceId,
            slotId: a.slotId,
            otherSessionId: right.sessionId,
            message: `资源项 ${a.resourceId} 同时被场次 ${right.sessionId} 占用`,
          });
          conflicts.push({
            sessionId: right.sessionId,
            type: "resource-contention",
            resourceId: b.resourceId,
            slotId: b.slotId,
            otherSessionId: left.sessionId,
            message: `资源项 ${b.resourceId} 同时被场次 ${left.sessionId} 占用`,
          });
        }
      }
    }
  }
  return conflicts;
}
