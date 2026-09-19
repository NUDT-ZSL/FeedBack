import { roundHalfUp } from "./utils.js";

const STAGE_LABEL = {
  outgoing: "增伤",
  vulnerability: "易伤",
  reduction: "减伤",
  shield: "护盾"
};

export function resolveDamage({
  base,
  actor,
  target,
  rules,
  invalidRuleIds,
  sourceTrace,
  allowOutgoing = true,
  reason = "skill"
}) {
  const trace = {
    reason,
    base,
    stages: [],
    amount: 0,
    shielded: 0,
    targetHpBefore: target.hp
  };
  let amount = roundHalfUp(base);

  const activeRulesByStage = collectRules({
    rules,
    invalidRuleIds,
    actor,
    target,
    sourceTrace
  });

  if (allowOutgoing) {
    amount = applyPercentageStage({
      stage: "outgoing",
      amount,
      unit: actor,
      rules: activeRulesByStage.outgoing,
      trace,
      mode: "increase",
      sourceTrace
    });
  }

  amount = applyPercentageStage({
    stage: "vulnerability",
    amount,
    unit: target,
    rules: activeRulesByStage.vulnerability,
    trace,
    mode: "increase",
    sourceTrace
  });

  amount = applyReduction(amount, activeRulesByStage.reduction, trace, sourceTrace);
  amount = applyShields(amount, target, activeRulesByStage.shield, trace, sourceTrace);

  const actual = Math.min(amount, Math.max(0, target.hp));
  target.hp = Math.max(0, target.hp - actual);
  trace.amount = actual;
  trace.targetHpAfter = target.hp;
  return trace;
}

function statusContributions(stage, unit, sourceTrace) {
  const kinds = {
    outgoing: ["outgoingIncrease"],
    vulnerability: ["vulnerable"],
    reduction: ["reduction"]
  }[stage] || [];
  return (unit?.statuses || [])
    .filter((status) => kinds.includes(status.kind))
    .map((status) => {
      const value = roundHalfUp((status.value || 0) * status.stacks);
      const item = {
        id: status.instanceId,
        kind: "status",
        effectId: status.effectId,
        label: status.name,
        value,
        stacks: status.stacks,
        priority: status.priority ?? 100,
        sources: cloneSources(status.sources)
      };
      sourceTrace.push({ type: "contribution-located", stage, ...item, unitId: unit.id });
      return item;
    });
}

function cloneSources(sources) {
  return (sources || []).map((source) => ({ ...source }));
}

function collectRules({ rules, invalidRuleIds, actor, target, sourceTrace }) {
  const byStage = { outgoing: [], vulnerability: [], reduction: [], shield: [] };
  for (const rule of rules) {
    if (!rule?.id || invalidRuleIds.has(rule.id)) {
      if (rule?.id && invalidRuleIds.has(rule.id)) {
        sourceTrace.push({ type: "rule-skipped-invalid", ruleId: rule.id, reason: "missing-reference-or-cycle" });
      }
      continue;
    }
    const holder = rule.requireOn === "actor" ? actor : target;
    const effectIds = new Set((holder.statuses || []).map((status) => status.effectId));
    const missingEffect = (rule.requiredEffects || []).some((effectId) => !effectIds.has(effectId));
    if (missingEffect) continue;

    const memo = new Map();
    if (!isRuleActive(rule, rules, invalidRuleIds, actor, target, memo)) {
      sourceTrace.push({ type: "rule-skipped-dependency", ruleId: rule.id, holderId: holder.id });
      continue;
    }

    byStage[rule.stage]?.push({
      id: rule.id,
      kind: "rule",
      ruleId: rule.id,
      label: rule.name || rule.id,
      value: rule.value,
      priority: rule.priority ?? 100,
      holderId: holder.id,
      targetSide: rule.target || "target"
    });
  }
  for (const stage of Object.keys(byStage)) {
    byStage[stage].push(...statusContributions(stage, stage === "outgoing" ? actor : target, sourceTrace));
    byStage[stage].sort((a, z) => a.priority - z.priority || a.id.localeCompare(z.id));
  }
  return byStage;
}

function applyPercentageStage({ stage, amount, unit, rules, trace, mode, sourceTrace }) {
  const stageTrace = {
    stage,
    label: STAGE_LABEL[stage],
    unitId: unit.id,
    before: amount,
    contributions: [],
    after: amount
  };
  for (const contribution of rules) {
    const delta = roundHalfUp(amount * contribution.value / 100);
    amount += delta;
    const row = {
      source: contribution.label,
      sourceKind: contribution.kind,
      value: contribution.value,
      priority: contribution.priority,
      stacks: contribution.stacks,
      sources: contribution.sources,
      delta,
      amountAfter: amount
    };
    stageTrace.contributions.push(row);
    sourceTrace.push({ type: "contribution-applied", stage, holderId: unit.id, ...row });
  }
  stageTrace.after = amount;
  trace.stages.push(stageTrace);
  return amount;
}

function applyReduction(amount, rules, trace, sourceTrace) {
  const stageTrace = {
    stage: "reduction",
    label: STAGE_LABEL.reduction,
    before: amount,
    contributions: [],
    after: amount
  };
  for (const contribution of rules) {
    const reduced = roundHalfUp(amount * contribution.value / 100);
    amount -= reduced;
    const row = {
      source: contribution.label,
      sourceKind: contribution.kind,
      value: contribution.value,
      priority: contribution.priority,
      stacks: contribution.stacks,
      sources: contribution.sources,
      delta: -reduced,
      amountAfter: amount
    };
    stageTrace.contributions.push(row);
    sourceTrace.push({ type: "contribution-applied", stage: "reduction", ...row });
  }
  stageTrace.after = amount;
  trace.stages.push(stageTrace);
  return amount;
}

function applyShields(amount, target, rules, trace, sourceTrace) {
  const stageTrace = {
    stage: "shield",
    label: STAGE_LABEL.shield,
    before: amount,
    contributions: [],
    after: amount
  };
  const shields = [
    ...rules.map((rule) => ({
      isRule: true,
      name: rule.label,
      instanceId: rule.id,
      effectId: null,
      appliedTurn: 0,
      remaining: Math.max(0, roundHalfUp(rule.value)),
      priority: rule.priority ?? 100
    })),
    ...(target.statuses || [])
      .filter((status) => status.kind === "shield" && status.remaining > 0)
      .map((status) => ({ ...status, priority: status.priority ?? 100 }))
  ]
    .filter((shield) => shield.remaining > 0)
    .sort((a, z) => a.priority - z.priority || a.appliedTurn - z.appliedTurn || a.instanceId.localeCompare(z.instanceId));

  let remainingDamage = Math.max(0, amount);
  for (const shield of shields) {
    if (remainingDamage <= 0) break;
    const capacityBefore = shield.remaining;
    const absorbed = Math.min(capacityBefore, remainingDamage);
    if (!shield.isRule) shield.remaining -= absorbed;
    remainingDamage -= absorbed;
    trace.shielded += absorbed;
    const row = {
      source: shield.name,
      sourceKind: shield.isRule ? "rule" : "status",
      priority: shield.priority,
      effectId: shield.effectId,
      value: capacityBefore,
      remaining: shield.isRule ? null : shield.remaining,
      delta: -absorbed,
      amountAfter: remainingDamage
    };
    stageTrace.contributions.push(row);
    sourceTrace.push({ type: "shield-absorbed", targetId: target.id, ...row });
  }
  stageTrace.after = remainingDamage;
  trace.stages.push(stageTrace);
  return remainingDamage;
}

function isRuleActive(rule, rules, invalidRuleIds, actor, target, memo) {
  if (!rule || invalidRuleIds.has(rule.id)) return false;
  if (memo.has(rule.id)) return memo.get(rule.id);
  memo.set(rule.id, false);
  const holder = rule.requireOn === "actor" ? actor : target;
  const effectsActive = (rule.requiredEffects || []).every((effectId) =>
    (holder.statuses || []).some((status) => status.effectId === effectId)
  );
  const dependenciesActive = (rule.requiredRules || []).every((requiredId) => {
    const required = rules.find((candidate) => candidate.id === requiredId);
    return isRuleActive(required, rules, invalidRuleIds, actor, target, memo);
  });
  const active = effectsActive && dependenciesActive;
  memo.set(rule.id, active);
  return active;
}

export function resolveHealing(base, target, traceList) {
  const amount = Math.min(roundHalfUp(base), target.maxHp - target.hp);
  target.hp += amount;
  traceList.push({ type: "healing", base, amount, targetId: target.id, hpAfter: target.hp });
  return amount;
}
