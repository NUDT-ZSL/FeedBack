import { cloneData, canonicalize, stableHash } from "./utils.js";
import { simulateBattle } from "./engine.js";

export function createSimulationCache(input) {
  const full = simulateBattle(input);
  const actionKeys = (input.actions || []).map((action, index) => actionKey(action, index));
  const result = {
    input: cloneData(input),
    full,
    actionKeys,
    postActionStates: full.postActionStates,
    events: full.events,
    finalHash: hashState(full.finalState)
  };
  return result;
}

export function commitReplayCache(input, replay) {
  return {
    input: cloneData(input),
    actionKeys: (input.actions || []).map((action, index) => actionKey(action, index)),
    postActionStates: replay.postActionStates,
    events: replay.events,
    finalHash: replay.finalHash
  };
}

export function replayIncrementally(cache, nextInput, options = {}) {
  const oldInput = cloneData(cache.input);
  const oldActions = oldInput.actions || [];
  const nextActions = nextInput.actions || [];
  const globalStart = findGlobalChangeStart(oldInput, nextInput);
  let start = globalStart;

  for (let index = 0; index < Math.max(oldActions.length, nextActions.length); index += 1) {
    if (index >= oldActions.length || index >= nextActions.length) {
      start = Math.min(start, index);
      break;
    }
    if (index >= globalStart) break;
    if (actionKey(oldActions[index], index) !== actionKey(nextActions[index], index)) {
      start = index;
      break;
    }
  }

  const initialState = start === 0 ? undefined : cloneData(cache.postActionStates[start - 1]);
  const suffixInput = {
    ...cloneData(nextInput),
    actions: nextActions.slice(start)
  };
  const suffix = simulateBattle(suffixInput, {
    initialState,
    startActionIndex: start,
    includeInitial: false
  });

  const events = [
    ...cache.events.filter((event) => event.kind === "initial" || (event.actionIndex !== undefined && event.actionIndex < start)),
    ...suffix.events
  ];
  const postActionStates = [
    ...cache.postActionStates.slice(0, start),
    ...suffix.postActionStates
  ];
  const finalState = suffix.finalState;
  const suffixValidation = suffix.validation;
  const fullVerification = options.verify === false ? null : simulateBattle(nextInput);

  return {
    start,
    reusedActions: start,
    recomputedActions: nextActions.length - start,
    events,
    postActionStates,
    finalState,
    finalHash: hashState(finalState),
    verification: fullVerification ? {
      hash: hashState(fullVerification.finalState),
      equal: canonicalize(finalState) === canonicalize(fullVerification.finalState)
    } : null,
    validation: fullVerification?.validation || suffixValidation,
    fullEvents: fullVerification?.events || null,
    fullFinalState: fullVerification?.finalState || null
  };
}

export function hashState(state) {
  return stableHash(canonicalize(state));
}

function actionKey(action, index) {
  return canonicalize({ index, ...action });
}

function findGlobalChangeStart(oldInput, nextInput) {
  if (canonicalize(oldInput.config || {}) !== canonicalize(nextInput.config || {})) return 0;
  if (canonicalize(oldInput.units || []) !== canonicalize(nextInput.units || [])) return 0;

  let start = (oldInput.actions || []).length;
  const oldSkills = oldInput.skills || {};
  const nextSkills = nextInput.skills || {};
  for (const skillId of unionKeys(oldSkills, nextSkills)) {
    if (canonicalize(oldSkills[skillId]) !== canonicalize(nextSkills[skillId])) {
      start = Math.min(start, firstActionUsingSkill(nextInput, skillId));
    }
  }

  const oldEffects = oldInput.effects || {};
  const nextEffects = nextInput.effects || {};
  for (const effectId of unionKeys(oldEffects, nextEffects)) {
    if (canonicalize(oldEffects[effectId]) !== canonicalize(nextEffects[effectId])) {
      start = Math.min(
        start,
        firstEffectMatterIndex(nextInput, effectId),
        firstRuleInfluenceIndex(nextInput, effectId)
      );
    }
  }

  const oldRuleMap = new Map((oldInput.rules || []).map((rule) => [rule.id, rule]));
  const nextRuleMap = new Map((nextInput.rules || []).map((rule) => [rule.id, rule]));
  for (const ruleId of unionKeys(Object.fromEntries(oldRuleMap), Object.fromEntries(nextRuleMap))) {
    if (canonicalize(oldRuleMap.get(ruleId)) !== canonicalize(nextRuleMap.get(ruleId))) {
      const oldDependencies = collectDependencies(oldRuleMap.get(ruleId), oldInput.rules || []);
      const nextDependencies = collectDependencies(nextRuleMap.get(ruleId), nextInput.rules || []);
      const effectIds = new Set([...oldDependencies.effects, ...nextDependencies.effects]);
      let ruleStart = 0;
      if (effectIds.size > 0) {
        ruleStart = (nextInput.actions || []).length;
        for (const effectId of effectIds) {
          ruleStart = Math.min(ruleStart, firstRuleInfluenceIndex(nextInput, effectId));
        }
      }
      start = Math.min(start, ruleStart);
    }
  }
  return Math.max(0, start);
}

function unionKeys(a, b) {
  return new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
}

function firstActionUsingSkill(input, skillId) {
  const index = (input.actions || []).findIndex((action) => action.skillId === skillId);
  return index === -1 ? (input.actions || []).length : index;
}

function firstEffectMatterIndex(input, effectId) {
  const initialIndex = (input.units || []).some((unit) =>
    (unit.initialStatuses || []).some((status) => status.effectId === effectId)
  ) ? 0 : Infinity;
  const actionIndex = (input.actions || []).findIndex((action) =>
    ((input.skills?.[action.skillId]?.effects) || []).some((applied) => applied.effectId === effectId)
  );
  return Math.min(initialIndex, actionIndex === -1 ? Infinity : actionIndex);
}

function firstRuleInfluenceIndex(input, effectId) {
  const actions = input.actions || [];
  for (let index = 0; index < actions.length; index += 1) {
    if (ruleCouldApplyAtAction(input, actions[index], effectId, index)) {
      return index;
    }
  }
  return actions.length;
}

function ruleCouldApplyAtAction(input, action, effectId, actionIndex) {
  const actions = input.actions || [];
  const targetId = action?.targetId;
  const actorId = action?.actorId;
  if (!targetId || !actorId) return true;
  const target = (input.units || []).find((unit) => unit.id === targetId);
  const actor = (input.units || []).find((unit) => unit.id === actorId);
  if ((target?.initialStatuses || []).some((status) => status.effectId === effectId)) return true;
  if ((actor?.initialStatuses || []).some((status) => status.effectId === effectId)) return true;

  for (const prior of actions.slice(0, actionIndex + 1)) {
    const skill = input.skills?.[prior.skillId];
    if (!skill) continue;
    for (const applied of skill.effects || []) {
      if (applied.effectId !== effectId) continue;
      const destinationId = applied.target === "actor" ? prior.actorId : prior.targetId;
      if (destinationId === targetId || destinationId === actorId) return true;
    }
  }
  return false;
}

function collectDependencies(rule, rules) {
  const effects = new Set();
  const ruleIds = new Set();
  const visited = new Set();
  const visit = (current) => {
    if (!current || visited.has(current.id)) return;
    visited.add(current.id);
    ruleIds.add(current.id);
    for (const effectId of current.requiredEffects || []) effects.add(effectId);
    for (const ruleId of current.requiredRules || []) {
      visit(rules.find((candidate) => candidate.id === ruleId));
    }
  };
  visit(rule);
  return { effects, ruleIds };
}
