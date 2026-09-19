import { clamp } from "./utils.js";

export function createStatusInstance(effectId, effect, options = {}, source = {}) {
  const duration = Number.isFinite(options.duration) ? options.duration : effect.duration;
  const stacks = options.stacks ?? effect.stacks ?? 1;
  const value = Number.isFinite(options.value) ? options.value : effect.value;
  const instance = {
    instanceId: options.instanceId || `${effectId}:${source.actionIndex ?? "init"}:${source.skillId || "initial"}:${source.targetId || "target"}`,
    effectId,
    name: effect.name || effectId,
    kind: effect.kind,
    priority: Number.isFinite(options.priority) ? options.priority : effect.priority ?? 100,
    duration,
    stacks: effect.kind === "shield" && !options.stacks ? 1 : Math.max(1, stacks),
    value,
    appliedTurn: source.turn ?? 0,
    sourceActionIndex: source.actionIndex ?? null,
    sourceSkillId: source.skillId || null,
    sourceUnitId: source.actorId || null,
    sources: options.sources || [{
      actionIndex: source.actionIndex ?? null,
      skillId: source.skillId || null,
      unitId: source.actorId || null,
      turn: source.turn ?? null
    }]
  };
  if (effect.kind === "shield") {
    instance.remaining = Number.isFinite(options.remaining) ? options.remaining : value * instance.stacks;
  }
  return instance;
}

export function applyStatus(unit, effectId, effect, options, source, trace) {
  if (unit.hp <= 0) {
    trace.push({ type: "status-skipped-dead", effectId, targetId: unit.id });
    return;
  }
  const stacking = effect.stacking || "replace";
  const existing = [...(unit.statuses || [])].reverse().find((status) => status.effectId === effectId);
  if (!existing || stacking === "replace") {
    const created = createStatusInstance(effectId, effect, options, source);
    if (existing) {
      unit.statuses[unit.statuses.indexOf(existing)] = created;
    } else {
      unit.statuses.push(created);
    }
    trace.push({
      type: "status-added",
      effectId,
      stacking: existing ? "replace" : "new",
      targetId: unit.id,
      replacedInstanceId: existing?.instanceId || null,
      instanceId: created.instanceId
    });
    return created;
  }

  if (stacking === "refresh") {
    const replacement = createStatusInstance(effectId, effect, { ...options, instanceId: existing.instanceId }, source);
    const index = unit.statuses.indexOf(existing);
    unit.statuses[index] = replacement;
    trace.push({ type: "status-refreshed", effectId, targetId: unit.id, instanceId: existing.instanceId, duration: replacement.duration });
    return replacement;
  }

  if (stacking === "stack") {
    const maxStacks = effect.maxStacks || options.maxStacks || 99;
    const before = existing.stacks;
    const added = Number.isFinite(options.stacks) ? options.stacks : (Number.isFinite(effect.stacks) ? effect.stacks : 1);
    if (added <= 0) {
      trace.push({ type: "status-stack-ignored", effectId, targetId: unit.id, reason: "non-positive-stack-count" });
      return existing;
    }
    existing.stacks = clamp(before + added, 1, maxStacks);
    existing.duration = Number.isFinite(options.duration) ? options.duration : existing.duration;
    if (Number.isFinite(options.value)) existing.value = options.value;
    if (existing.kind === "shield") existing.remaining = existing.value * existing.stacks;
    if (!existing.sources) {
      existing.sources = Array.from({ length: before }, (_, index) => ({
        actionIndex: existing.sourceActionIndex,
        skillId: existing.sourceSkillId,
        unitId: existing.sourceUnitId,
        turn: existing.appliedTurn,
        duplicateIndex: index
      }));
    }
    const nextSource = {
      actionIndex: source.actionIndex ?? null,
      skillId: source.skillId || null,
      unitId: source.actorId || null,
      turn: source.turn ?? null
    };
    const sourceLimit = effect.maxStacks || maxStacks;
    if (existing.sources.length < sourceLimit) {
      existing.sources.push(nextSource);
    }
    trace.push({ type: "status-stacked", effectId, targetId: unit.id, before, after: existing.stacks, capped: existing.stacks !== before + added, sources: existing.sources });
    return existing;
  }

  trace.push({ type: "status-ignored", effectId, stacking, targetId: unit.id });
  return existing;
}

export function expireStatuses(unit, turn, trace) {
  const kept = [];
  for (const status of unit.statuses || []) {
    if (status.duration !== null && status.duration !== undefined && status.duration <= 0) {
      trace.push({ type: "status-expired", effectId: status.effectId, instanceId: status.instanceId, targetId: unit.id, turn });
    } else {
      kept.push(status);
    }
  }
  unit.statuses = kept;
}

export function removeConsumedShields(unit, trace) {
  const kept = [];
  for (const status of unit.statuses || []) {
    if (status.kind === "shield" && status.remaining <= 0) {
      trace?.push({ type: "shield-removed-consumed", effectId: status.effectId, instanceId: status.instanceId, targetId: unit.id });
    } else {
      kept.push(status);
    }
  }
  unit.statuses = kept;
}
