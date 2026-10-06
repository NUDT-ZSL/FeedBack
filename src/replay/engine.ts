import type {
  Adjudication,
  AffectedScope,
  ConflictGroup,
  Diagnostic,
  EventImpact,
  KeyEvent,
  ObjectState,
  ReplayInput,
  ReplayResult,
  SpatialRecord,
} from "./types.ts";

interface NormalizedInput {
  records: SpatialRecord[];
  events: KeyEvent[];
  adjudications: Adjudication[];
}

interface Analysis {
  input: NormalizedInput;
  supersededIds: Set<string>;
  conflicts: ConflictGroup[];
  excludedRecordIds: Set<string>;
  diagnostics: Diagnostic[];
}

export function conflictIdOf(record: SpatialRecord): string {
  return `${record.objectId}|${record.field}|${record.observedAt}`;
}

function normalizeInput(input: ReplayInput): NormalizedInput {
  const records = [...input.records].sort((a, b) =>
    a.observedAt === b.observedAt
      ? a.id.localeCompare(b.id)
      : a.observedAt - b.observedAt,
  );
  const events = [...input.events].sort((a, b) =>
    a.occurredAt === b.occurredAt
      ? a.id.localeCompare(b.id)
      : a.occurredAt - b.occurredAt,
  );
  const adjudications = [...(input.adjudications ?? [])].sort((a, b) =>
    a.conflictId.localeCompare(b.conflictId),
  );
  return { records, events, adjudications };
}

function analyze(input: ReplayInput): Analysis {
  const normalized = normalizeInput(input);
  const diagnostics: Diagnostic[] = [];

  const recordById = new Map(normalized.records.map((record) => [record.id, record]));
  const supersededIds = new Set<string>();
  for (const record of normalized.records) {
    if (record.corrects === undefined) {
      continue;
    }
    if (recordById.has(record.corrects)) {
      supersededIds.add(record.corrects);
    } else {
      diagnostics.push({
        severity: "warning",
        kind: "dangling-correction",
        message: `record ${record.id} corrects unknown record ${record.corrects}`,
        refs: [record.id, record.corrects],
      });
    }
  }

  const activeRecords = normalized.records.filter((record) => !supersededIds.has(record.id));
  const groups = new Map<string, SpatialRecord[]>();
  for (const record of activeRecords) {
    const key = conflictIdOf(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  const adjudicationByConflict = new Map(
    normalized.adjudications.map((adjudication) => [adjudication.conflictId, adjudication]),
  );

  const conflicts: ConflictGroup[] = [];
  const excludedRecordIds = new Set<string>();
  for (const [key, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const distinctValues = new Set(members.map((member) => member.value));
    if (distinctValues.size < 2) {
      continue;
    }
    const first = members[0];
    const adjudication = adjudicationByConflict.get(key);
    const winnerValid =
      adjudication !== undefined &&
      members.some((member) => member.id === adjudication.winnerRecordId);
    if (adjudication !== undefined && !winnerValid) {
      diagnostics.push({
        severity: "error",
        kind: "unknown-adjudication",
        message: `adjudication for ${key} names unknown winner ${adjudication.winnerRecordId}`,
        refs: [key, adjudication.winnerRecordId],
      });
    }
    const resolved = winnerValid;
    conflicts.push({
      conflictId: key,
      objectId: first.objectId,
      field: first.field,
      observedAt: first.observedAt,
      recordIds: members.map((member) => member.id).sort(),
      resolved,
      ...(resolved ? { winnerRecordId: adjudication.winnerRecordId } : {}),
    });
    for (const member of members) {
      if (!resolved || member.id !== adjudication.winnerRecordId) {
        excludedRecordIds.add(member.id);
      }
    }
    if (!resolved) {
      diagnostics.push({
        severity: "error",
        kind: "unresolved-conflict",
        message: `conflict ${key} kept ${members.length} records without adjudication`,
        refs: [key, ...members.map((member) => member.id).sort()],
      });
    }
  }

  for (const adjudication of normalized.adjudications) {
    if (!groups.has(adjudication.conflictId)) {
      diagnostics.push({
        severity: "error",
        kind: "unknown-adjudication",
        message: `adjudication targets unknown conflict ${adjudication.conflictId}`,
        refs: [adjudication.conflictId, adjudication.winnerRecordId],
      });
    }
  }

  diagnostics.push(...detectLinkDiagnostics(normalized.events));
  diagnostics.sort((a, b) => {
    const left = `${a.kind}|${a.refs.join(",")}|${a.message}`;
    const right = `${b.kind}|${b.refs.join(",")}|${b.message}`;
    return left.localeCompare(right);
  });

  return { input: normalized, supersededIds, conflicts, excludedRecordIds, diagnostics };
}

function detectLinkDiagnostics(events: KeyEvent[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const eventIds = new Set(events.map((event) => event.id));

  for (const event of events) {
    for (const target of [...event.links].sort()) {
      if (!eventIds.has(target)) {
        diagnostics.push({
          severity: "error",
          kind: "missing-link",
          message: `event ${event.id} links to missing event ${target}`,
          refs: [event.id, target],
        });
      }
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const event of events) {
    adjacency.set(
      event.id,
      event.links.filter((target) => eventIds.has(target)),
    );
  }
  for (const component of stronglyConnectedComponents([...eventIds].sort(), adjacency)) {
    const isSelfLoop =
      component.length === 1 && (adjacency.get(component[0]) ?? []).includes(component[0]);
    if (component.length > 1 || isSelfLoop) {
      diagnostics.push({
        severity: "error",
        kind: "link-cycle",
        message: `event links form a cycle: ${component.join(" -> ")}`,
        refs: component,
      });
    }
  }
  return diagnostics;
}

function stronglyConnectedComponents(ids: string[], adjacency: Map<string, string[]>): string[][] {
  const indexById = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let nextIndex = 0;

  const visit = (id: string): void => {
    indexById.set(id, nextIndex);
    lowLink.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
    for (const target of [...(adjacency.get(id) ?? [])].sort()) {
      if (!indexById.has(target)) {
        visit(target);
        lowLink.set(id, Math.min(lowLink.get(id)!, lowLink.get(target)!));
      } else if (onStack.has(target)) {
        lowLink.set(id, Math.min(lowLink.get(id)!, indexById.get(target)!));
      }
    }
    if (lowLink.get(id) === indexById.get(id)) {
      const component: string[] = [];
      let member = "";
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      components.push(component.sort());
    }
  };

  for (const id of ids) {
    if (!indexById.has(id)) {
      visit(id);
    }
  }
  return components.sort((a, b) => a.join(",").localeCompare(b.join(",")));
}

function deriveObjectState(analysis: Analysis, objectId: string): ObjectState {
  const state: ObjectState = {};
  for (const record of analysis.input.records) {
    if (record.objectId !== objectId) {
      continue;
    }
    if (analysis.supersededIds.has(record.id) || analysis.excludedRecordIds.has(record.id)) {
      continue;
    }
    const current = state[record.field];
    if (
      current === undefined ||
      record.observedAt > current.observedAt ||
      (record.observedAt === current.observedAt && record.id > current.recordId)
    ) {
      state[record.field] = {
        value: record.value,
        recordId: record.id,
        observedAt: record.observedAt,
      };
    }
  }
  return state;
}

function eventClosure(events: KeyEvent[], startId: string): KeyEvent[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    const event = byId.get(id);
    if (event === undefined) {
      continue;
    }
    for (const target of event.links) {
      if (!visited.has(target)) {
        queue.push(target);
      }
    }
  }
  return events.filter((event) => visited.has(event.id));
}

function deriveEventImpact(events: KeyEvent[], eventId: string): EventImpact {
  const closure = eventClosure(events, eventId);
  const objects = [...new Set(closure.map((event) => event.objectId))].sort();
  const times = closure.map((event) => event.occurredAt);
  return {
    objects,
    timeRange: [Math.min(...times), Math.max(...times)],
  };
}

export function replay(input: ReplayInput): ReplayResult {
  const analysis = analyze(input);
  const objectStates: Record<string, ObjectState> = {};
  const objectIds = [...new Set(analysis.input.records.map((record) => record.objectId))].sort();
  for (const objectId of objectIds) {
    const state = deriveObjectState(analysis, objectId);
    if (Object.keys(state).length > 0) {
      objectStates[objectId] = state;
    }
  }
  const eventImpacts: Record<string, EventImpact> = {};
  for (const event of analysis.input.events) {
    eventImpacts[event.id] = deriveEventImpact(analysis.input.events, event.id);
  }
  return {
    objectStates,
    eventImpacts,
    conflicts: analysis.conflicts,
    diagnostics: analysis.diagnostics,
  };
}

function reverseReachableEvents(events: KeyEvent[], startIds: string[]): string[] {
  const reverse = new Map<string, string[]>();
  for (const event of events) {
    for (const target of event.links) {
      const list = reverse.get(target) ?? [];
      list.push(event.id);
      reverse.set(target, list);
    }
  }
  const visited = new Set<string>();
  const queue = [...startIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    for (const source of reverse.get(id) ?? []) {
      queue.push(source);
    }
  }
  return [...visited].sort();
}

function scopeForObjects(input: ReplayInput, objectIds: string[], fromTime: number, reason: string): AffectedScope {
  const objects = [...new Set(objectIds)].sort();
  const relevantRecords = input.records.filter((record) => objects.includes(record.objectId));
  const maxTime = relevantRecords.reduce(
    (acc, record) => Math.max(acc, record.observedAt),
    fromTime,
  );
  const ownedEventIds = input.events
    .filter((event) => objects.includes(event.objectId))
    .map((event) => event.id);
  return {
    objects,
    eventIds: reverseReachableEvents(input.events, ownedEventIds),
    timeRange: [fromTime, maxTime],
    reason,
  };
}

export function scopeForAdjudication(input: ReplayInput, adjudication: Adjudication): AffectedScope {
  const [objectId, , observedAtText] = adjudication.conflictId.split("|");
  const observedAt = Number(observedAtText);
  return scopeForObjects(
    input,
    [objectId],
    Number.isFinite(observedAt) ? observedAt : 0,
    `adjudication:${adjudication.conflictId}`,
  );
}

export function scopeForCorrection(input: ReplayInput, correction: SpatialRecord): AffectedScope {
  const corrected = input.records.find((record) => record.id === correction.corrects);
  const objectIds = [correction.objectId];
  if (corrected !== undefined && corrected.objectId !== correction.objectId) {
    objectIds.push(corrected.objectId);
  }
  const fromTime = Math.min(correction.observedAt, corrected?.observedAt ?? correction.observedAt);
  return scopeForObjects(input, objectIds, fromTime, `correction:${correction.id}`);
}

export function replayAffected(
  previous: ReplayResult,
  input: ReplayInput,
  scope: AffectedScope,
): ReplayResult {
  const analysis = analyze(input);
  const objectStates: Record<string, ObjectState> = { ...previous.objectStates };
  for (const objectId of scope.objects) {
    const state = deriveObjectState(analysis, objectId);
    if (Object.keys(state).length > 0) {
      objectStates[objectId] = state;
    } else {
      delete objectStates[objectId];
    }
  }
  const eventImpacts: Record<string, EventImpact> = { ...previous.eventImpacts };
  const eventIds = new Set(analysis.input.events.map((event) => event.id));
  for (const eventId of scope.eventIds) {
    if (eventIds.has(eventId)) {
      eventImpacts[eventId] = deriveEventImpact(analysis.input.events, eventId);
    } else {
      delete eventImpacts[eventId];
    }
  }
  return {
    objectStates,
    eventImpacts,
    conflicts: analysis.conflicts,
    diagnostics: analysis.diagnostics,
  };
}
