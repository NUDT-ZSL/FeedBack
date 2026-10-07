import { OrchestrationStore } from "./store.ts";
import { scheduleSession } from "./schedule.ts";
import type {
  Participant,
  Pools,
  ResourceItem,
  ScheduleResult,
  SessionSpec,
} from "./types.ts";

export type Operation =
  | { op: "upsertParticipant"; participant: Participant }
  | { op: "removeParticipant"; id: string }
  | { op: "upsertResource"; resource: ResourceItem }
  | { op: "removeResource"; id: string }
  | { op: "addSession"; spec: SessionSpec }
  | { op: "removeSession"; id: string }
  | { op: "updateSessionSpec"; id: string; patch: Partial<Omit<SessionSpec, "id">> }
  | { op: "switchSession"; id: string };

export interface Scenario {
  name?: string;
  participants: Participant[];
  resources: ResourceItem[];
  sessions: SessionSpec[];
  operations?: Operation[];
}

export interface PhaseReport {
  phase: string;
  rederived: string[];
  activeSessionId: string | null;
  results: ScheduleResult[];
  conflicts: ReturnType<OrchestrationStore["getConflicts"]>;
  checks: { name: string; ok: boolean; detail?: string }[];
}

export interface BatchReport {
  name: string;
  ok: boolean;
  phases: PhaseReport[];
}

export function buildStore(scenario: Scenario): OrchestrationStore {
  const store = new OrchestrationStore();
  for (const participant of scenario.participants) {
    store.upsertParticipant(participant);
  }
  for (const resource of scenario.resources) {
    store.upsertResource(resource);
  }
  for (const spec of scenario.sessions) {
    store.addSession(spec);
  }
  store.sync();
  return store;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length || keysA.some((key, index) => key !== keysB[index])) {
    return false;
  }
  return keysA.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

function noStaleReferences(
  store: OrchestrationStore,
  pools: Pools,
): { name: string; ok: boolean; detail?: string } {
  for (const id of store.listSessionIds()) {
    const result = store.getResult(id);
    if (!result) {
      continue;
    }
    for (const allocation of result.allocations) {
      if (!pools.participants.has(allocation.participantId)) {
        return {
          name: "无失效引用",
          ok: false,
          detail: `场次 ${id} 仍引用已移除参与者 ${allocation.participantId}`,
        };
      }
      if (!pools.resources.has(allocation.resourceId)) {
        return {
          name: "无失效引用",
          ok: false,
          detail: `场次 ${id} 仍引用已移除资源项 ${allocation.resourceId}`,
        };
      }
    }
  }
  return { name: "无失效引用", ok: true };
}

export function consistencyChecks(store: OrchestrationStore) {
  const pools = store.getPools();
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  for (const id of store.listSessionIds()) {
    const spec = store.getSessionSpec(id);
    const result = store.getResult(id);
    if (!spec || !result) {
      continue;
    }
    const single = scheduleSession(spec, pools);
    checks.push({
      name: `与单场编排一致:${id}`,
      ok: deepEqual(result, single),
      detail: deepEqual(result, single) ? undefined : JSON.stringify(single),
    });
  }
  checks.push(noStaleReferences(store, pools));
  return checks;
}

function snapshotPhase(
  store: OrchestrationStore,
  phase: string,
  rederived: string[],
): PhaseReport {
  return {
    phase,
    rederived,
    activeSessionId: store.getActiveSessionId(),
    results: store.listSessionIds().map((id) => store.getResult(id)) as ScheduleResult[],
    conflicts: store.getConflicts(),
    checks: consistencyChecks(store),
  };
}

function applyOperation(store: OrchestrationStore, operation: Operation): void {
  switch (operation.op) {
    case "upsertParticipant":
      store.upsertParticipant(operation.participant);
      break;
    case "removeParticipant":
      store.removeParticipant(operation.id);
      break;
    case "upsertResource":
      store.upsertResource(operation.resource);
      break;
    case "removeResource":
      store.removeResource(operation.id);
      break;
    case "addSession":
      store.addSession(operation.spec);
      break;
    case "removeSession":
      store.removeSession(operation.id);
      break;
    case "updateSessionSpec":
      store.updateSessionSpec(operation.id, operation.patch);
      break;
    case "switchSession":
      store.setActiveSession(operation.id);
      break;
  }
}

export function runScenario(scenario: Scenario): BatchReport {
  const store = buildStore(scenario);
  const phases = [snapshotPhase(store, "init", store.listSessionIds())];
  const operations = scenario.operations ?? [];
  operations.forEach((operation, index) => {
    const before = operation.op === "switchSession"
      ? store.listSessionIds().map((id) => store.getResult(id))
      : null;
    applyOperation(store, operation);
    const rederived = store.sync();
    if (before) {
      const after = store.listSessionIds().map((id) => store.getResult(id));
      const untouched = before.every((result, i) => result === after[i]);
      phases.push({
        phase: `${index + 1}:${operation.op}`,
        rederived,
        activeSessionId: store.getActiveSessionId(),
        results: after as ScheduleResult[],
        conflicts: store.getConflicts(),
        checks: [
          ...consistencyChecks(store),
          {
            name: "切换场次不触发重推",
            ok: untouched && rederived.length === 0,
            detail: untouched && rederived.length === 0
              ? undefined
              : `rederived=${rederived.join(",")}`,
          },
        ],
      });
      return;
    }
    phases.push(snapshotPhase(store, `${index + 1}:${operation.op}`, rederived));
  });
  return {
    name: scenario.name ?? "scenario",
    ok: phases.every((phase) => phase.checks.every((check) => check.ok)),
    phases,
  };
}
