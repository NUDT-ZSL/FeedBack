import { makeIssue } from "./utils.js";

const DAMAGE_STAGES = new Set(["outgoing", "vulnerability", "reduction", "shield"]);
const STACKING_MODES = new Set(["replace", "refresh", "stack"]);

export function validateInput(input) {
  const issues = [];
  const data = input || {};
  const effects = data.effects || {};
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const skills = data.skills || {};
  const units = Array.isArray(data.units) ? data.units : [];
  const actions = Array.isArray(data.actions) ? data.actions : [];

  for (const unit of units) {
    if (!unit || typeof unit.id !== "string") {
      issues.push(makeIssue("error", "UNIT_ID", "单位缺少 id", "units[]"));
      continue;
    }
    if (!Number.isFinite(unit.maxHp) || unit.maxHp <= 0) {
      issues.push(makeIssue("error", "UNIT_MAX_HP", `${unit.id} 的最大生命无效`, `units.${unit.id}.maxHp`));
    }
    if (!Number.isFinite(unit.hp)) {
      issues.push(makeIssue("error", "UNIT_HP", `${unit.id} 的生命无效`, `units.${unit.id}.hp`));
    }
    for (const status of unit.initialStatuses || []) {
      if (!effects[status.effectId]) {
        issues.push(makeIssue("error", "MISSING_EFFECT", `${unit.id} 初始状态引用不存在的效果 ${status.effectId}`, `units.${unit.id}.initialStatuses`));
      }
    }
  }

  for (const [effectId, effect] of Object.entries(effects)) {
    if (!effect || !effect.kind) {
      issues.push(makeIssue("error", "EFFECT_KIND", `效果 ${effectId} 缺少 kind`, `effects.${effectId}.kind`));
    }
    if (effect && !STACKING_MODES.has(effect.stacking || "replace")) {
      issues.push(makeIssue("error", "EFFECT_STACKING", `效果 ${effectId} 的叠加规则不受支持：${effect.stacking}`, `effects.${effectId}.stacking`));
    }
  }

  const ruleById = new Map();
  for (const rule of rules) validateRule(rule, rules, effects, ruleById, issues);
  const invalidRules = findRuleCycles(rules, issues);

  for (const [skillId, skill] of Object.entries(skills)) {
    if (!skill) continue;
    if (!Number.isFinite(skill.hitRate)) {
      issues.push(makeIssue("error", "SKILL_HIT_RATE", `技能 ${skillId} 缺少命中率`, `skills.${skillId}.hitRate`));
    }
    if (!Number.isFinite(skill.basePower)) {
      issues.push(makeIssue("error", "SKILL_POWER", `技能 ${skillId} 缺少基础数值`, `skills.${skillId}.basePower`));
    }
    for (const applied of skill.effects || []) {
      if (!effects[applied.effectId]) {
        issues.push(makeIssue("error", "MISSING_EFFECT", `技能 ${skillId} 施加不存在的效果 ${applied.effectId}`, `skills.${skillId}.effects`, { skillId, effectId: applied.effectId }));
      }
    }
  }

  validateActions(actions, units, skills, issues);
  return {
    ok: !issues.some((issue) => issue.level === "error"),
    issues,
    invalidRules
  };
}

function validateRule(rule, rules, effects, ruleById, issues) {
  if (!rule || typeof rule.id !== "string") {
    issues.push(makeIssue("error", "RULE_ID", "规则缺少 id", "rules[]"));
    return;
  }
  if (ruleById.has(rule.id)) {
    issues.push(makeIssue("error", "DUPLICATE_RULE", `规则 id 重复：${rule.id}`, `rules.${rule.id}`));
  }
  ruleById.set(rule.id, rule);
  if (!DAMAGE_STAGES.has(rule.stage)) {
    issues.push(makeIssue("error", "RULE_STAGE", `规则 ${rule.id} 的阶段不受支持：${rule.stage}`, `rules.${rule.id}.stage`, { ruleId: rule.id }));
  }
  if (!Number.isFinite(rule.value)) {
    issues.push(makeIssue("error", "RULE_VALUE", `规则 ${rule.id} 缺少数值`, `rules.${rule.id}.value`, { ruleId: rule.id }));
  }
  for (const effectId of rule.requiredEffects || []) {
    if (!effects[effectId]) {
      issues.push(makeIssue("error", "MISSING_EFFECT", `规则 ${rule.id} 引用不存在的效果 ${effectId}`, `rules.${rule.id}.requiredEffects`, { ruleId: rule.id, effectId }));
    }
  }
  for (const requiredRuleId of rule.requiredRules || []) {
    if (!rules.some((candidate) => candidate && candidate.id === requiredRuleId)) {
      issues.push(makeIssue("error", "MISSING_RULE", `规则 ${rule.id} 引用不存在的规则 ${requiredRuleId}`, `rules.${rule.id}.requiredRules`, { ruleId: rule.id, requiredRuleId }));
    }
  }
}

function validateActions(actions, units, skills, issues) {
  let previousTurn = 0;
  actions.forEach((action, index) => {
    const path = `actions[${index}]`;
    if (!action) {
      issues.push(makeIssue("error", "ACTION_EMPTY", `第 ${index + 1} 条行动为空`, path, { actionIndex: index }));
      return;
    }
    if (!Number.isInteger(action.turn) || action.turn < 1) {
      issues.push(makeIssue("error", "ACTION_TURN", `第 ${index + 1} 条行动回合无效`, path, { actionIndex: index }));
    } else if (action.turn < previousTurn) {
      issues.push(makeIssue("error", "ACTION_ORDER", `第 ${index + 1} 条行动早于前一回合并被跳过`, path, { actionIndex: index }));
    } else {
      previousTurn = action.turn;
    }
    const actor = units.find((unit) => unit && unit.id === action.actorId);
    const target = units.find((unit) => unit && unit.id === action.targetId);
    if (!actor) issues.push(makeIssue("error", "ACTION_ACTOR", `第 ${index + 1} 条行动的施法者不存在`, path, { actionIndex: index }));
    if (!target) issues.push(makeIssue("error", "ACTION_TARGET", `第 ${index + 1} 条行动的目标不存在`, path, { actionIndex: index }));
    if (!skills[action.skillId]) {
      issues.push(makeIssue("error", "ACTION_SKILL", `第 ${index + 1} 条行动引用不存在的技能 ${action.skillId}`, path, { actionIndex: index }));
    }
  });
}

function findRuleCycles(rules, issues) {
  const byId = new Map(rules.filter((rule) => rule?.id).map((rule) => [rule.id, rule]));
  const state = new Map();
  const stack = [];
  const cyclic = new Set();

  const visit = (ruleId) => {
    const mark = state.get(ruleId);
    if (mark === "active") {
      const cycleStart = stack.indexOf(ruleId);
      const cycle = stack.slice(cycleStart).concat(ruleId);
      for (const id of cycle) cyclic.add(id);
      issues.push(makeIssue("error", "RULE_CYCLE", `规则循环依赖：${cycle.join(" -> ")}`, `rules.${ruleId}`, { ruleIds: cycle }));
      return;
    }
    if (mark === "done") return;
    state.set(ruleId, "active");
    stack.push(ruleId);
    for (const next of byId.get(ruleId)?.requiredRules || []) {
      if (byId.has(next)) visit(next);
    }
    stack.pop();
    state.set(ruleId, "done");
  };

  for (const rule of rules) {
    if (rule?.id) visit(rule.id);
  }
  return cyclic;
}
