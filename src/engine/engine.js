import { cloneData, stableHash } from "./utils.js";
import { validateInput } from "./validation.js";
import { applyStatus, createStatusInstance, expireStatuses, removeConsumedShields } from "./statuses.js";
import { resolveDamage, resolveHealing } from "./damage.js";

export function simulateBattle(input, options = {}) {
  const validation = validateInput(input);
  const invalidRuleIds = collectInvalidRuleIds(validation);
  const effects = input?.effects || {};
  const rules = Array.isArray(input?.rules) ? input.rules : [];
  const skills = input?.skills || {};

  let state = options.initialState
    ? cloneData(options.initialState)
    : createInitialState(input);
  const startIndex = options.startActionIndex ?? 0;
  const actions = Array.isArray(input?.actions) ? input.actions : [];
  const events = options.includeInitial === false ? [] : [{
    kind: "initial",
    actionIndex: -1,
    turn: 0,
    data: { state: cloneData(state) }
  }];
  const postActionStates = [];

  actions.forEach((action, localIndex) => {
    const actionIndex = startIndex + localIndex;
    const actionTurn = Number.isInteger(action?.turn) ? action.turn : state.currentTurn + 1;
    for (let turn = (state.settledThroughTurn || 0) + 1; turn < actionTurn; turn += 1) {
      settleTurn({ state, turn, input, events, actionIndex });
    }
    const event = resolveAction({
      action,
      actionIndex,
      localIndex,
      state,
      input,
      effects,
      skills,
      rules,
      invalidRuleIds
    });
    events.push(event);
    if (Number.isInteger(action?.turn) && action.turn >= state.currentTurn) {
      state.currentTurn = action.turn;
    }
    postActionStates[localIndex] = cloneData(state);
  });

  if (input?.config?.finalTurnSettlement !== false && state.currentTurn > 0) {
    settleTurn({ state, turn: state.currentTurn, input, events, actionIndex: startIndex + actions.length });
  }

  return {
    validation,
    invalidRuleIds: [...invalidRuleIds],
    events,
    postActionStates,
    finalState: state
  };
}

function createInitialState(input) {
  const units = (input?.units || []).map((unit) => ({
    ...cloneData(unit),
    hp: Number(unit.hp),
    statuses: (unit.initialStatuses || []).flatMap((status, index) => {
      const effect = input.effects?.[status.effectId];
      if (!effect) return [];
      return [createStatusInstance(status.effectId, effect, {
        ...status,
        instanceId: `initial:${unit.id}:${status.effectId}:${index}`
      }, { turn: 0, targetId: unit.id })];
    })
  }));
  return { currentTurn: 0, settledThroughTurn: 0, units };
}

function collectInvalidRuleIds(validation) {
  const ids = new Set(validation.invalidRules || []);
  for (const issue of validation.issues) {
    if (issue.ruleId) ids.add(issue.ruleId);
  }
  return ids;
}

function resolveAction({ action, actionIndex, localIndex, state, input, effects, skills, rules, invalidRuleIds }) {
  const trace = {
    kind: "action",
    actionIndex,
    localIndex,
    turn: action?.turn,
    action: cloneData(action || {}),
    skipped: false,
    steps: []
  };
  const actor = state.units.find((unit) => unit.id === action?.actorId);
  const target = state.units.find((unit) => unit.id === action?.targetId);
  const skill = skills[action?.skillId];
  const push = (step) => trace.steps.push(step);

  if (!action || !Number.isInteger(action.turn) || action.turn < state.currentTurn || !actor || !target || !skill) {
    trace.skipped = true;
    trace.skipReason = "invalid-action";
    push({ type: "action-skipped", actorId: action?.actorId, targetId: action?.targetId, skillId: action?.skillId });
    return { ...trace, state: cloneData(state) };
  }

  if (actor.hp <= 0) {
    trace.skipped = true;
    trace.skipReason = "actor-dead";
    push({ type: "action-skipped", reason: "actor-dead", actorId: actor.id });
    return { ...trace, state: cloneData(state) };
  }

  const roll = deterministicRoll(actionIndex, action);
  const hitRate = clampNumber(skill.hitRate, 0, 100);
  const hit = roll <= hitRate * 100;
  push({
    type: "hit-check",
    hitRate,
    roll: roll / 100,
    threshold: hitRate,
    hit,
    formula: "deterministic hash(turn, actor, target, skill, index) mod 10000 / 100"
  });

  if (!hit) {
    push({ type: "miss", message: "行动未命中，数值和效果均不结算" });
    return { ...trace, state: cloneData(state) };
  }

  if ((skill.basePower || 0) > 0 && target.hp > 0) {
    const damageTrace = resolveDamage({
      base: skill.basePower,
      actor,
      target,
      rules,
      invalidRuleIds,
      sourceTrace: trace.steps,
      allowOutgoing: true,
      reason: "skill"
    });
    push({ type: "damage-resolved", ...damageTrace });
    removeConsumedShields(target, trace.steps);
  } else {
    push({ type: "damage-skipped", basePower: skill.basePower || 0 });
  }

  for (const applied of skill.effects || []) {
    const effect = effects[applied.effectId];
    const destination = applied.target === "actor" ? actor : target;
    if (!effect) {
      push({ type: "effect-skipped-missing", effectId: applied.effectId, targetId: destination?.id });
      continue;
    }
    const before = cloneData(destination.statuses);
    applyStatus(destination, applied.effectId, effect, applied, {
      actionIndex,
      skillId: action.skillId,
      actorId: actor.id,
      targetId: destination.id,
      turn: action.turn
    }, trace.steps);
    push({ type: "effect-applied", effectId: applied.effectId, destinationId: destination.id, before, after: cloneData(destination.statuses) });
  }

  trace.state = cloneData(state);
  return trace;
}

function deterministicRoll(actionIndex, action) {
  const seed = stableHash({
    turn: action.turn,
    actorId: action.actorId,
    targetId: action.targetId,
    skillId: action.skillId,
    actionIndex
  });
  return parseInt(seed.slice(0, 8), 16) % 10000;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function settleTurn({ state, turn, input, events, actionIndex }) {
  const event = {
    kind: "turn-end",
    actionIndex,
    turn,
    units: [],
    ticks: [],
    stateBefore: cloneData(state)
  };
  state.currentTurn = turn;
  state.settledThroughTurn = turn;
  const rules = Array.isArray(input.rules) ? input.rules : [];
  const invalidRuleIds = collectInvalidRuleIds(validateInput(input));

  for (const unit of state.units) {
    const unitTrace = { unitId: unit.id, ticks: [], removals: [] };
    event.units.push(unitTrace);
    if (unit.hp <= 0) {
      unit.statuses = [];
      unitTrace.removedAll = "unit-dead";
      continue;
    }

    const ordered = [...unit.statuses].sort((a, z) =>
      a.instanceId.localeCompare(z.instanceId)
    );
    for (const status of ordered) {
      if (!unit.statuses.includes(status)) continue;
      if (unit.hp <= 0) break;
      if (status.kind === "damageOverTime") {
        const trace = resolveDamage({
          base: (status.value || 0) * status.stacks,
          actor: unit,
          target: unit,
          rules,
          invalidRuleIds,
          sourceTrace: [],
          allowOutgoing: false,
          reason: "damageOverTime"
        });
        trace.statusId = status.instanceId;
        trace.effectId = status.effectId;
        trace.stacks = status.stacks;
        unitTrace.ticks.push(trace);
        event.ticks.push({ unitId: unit.id, ...trace });
      }
      if (status.kind === "healOverTime") {
        const amount = resolveHealing((status.value || 0) * status.stacks, unit, []);
        unitTrace.ticks.push({
          type: "healOverTime",
          effectId: status.effectId,
          statusId: status.instanceId,
          amount,
          targetHpAfter: unit.hp,
          stacks: status.stacks
        });
      }
    }
    removeConsumedShields(unit, unitTrace.ticks);

    for (const status of [...unit.statuses]) {
      if (status.duration === null || status.duration === undefined) {
        unitTrace.ticks.push({ type: "duration-kept", effectId: status.effectId, after: null });
      } else {
        status.duration -= 1;
        unitTrace.ticks.push({ type: "duration-decayed", effectId: status.effectId, after: status.duration });
      }
    }
    expireStatuses(unit, turn, unitTrace.ticks);
  }

  event.stateAfter = cloneData(state);
  events.push(event);
}
