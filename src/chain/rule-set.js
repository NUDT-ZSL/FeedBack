/**
 * 规则集：规则带版本，改写即 upsert 同 id 规则，版本递增。
 * 规则形态：
 * {
 *   id: string,
 *   priority: number,                 // 数值大者优先
 *   scope: (pos) => bool | {sources?, pattern?},  // 作用范围
 *   requires: [ruleId],               // 声明式依赖（用于静态成环/悬空检查）
 *   apply: (pos, api) => tag | null,  // 命中则产出标记候选；api.read/api.readOffset 读取下游依赖
 * }
 */
export class RuleSet {
  constructor() {
    this.rules = new Map();
    this.events = [];
  }

  upsert(rule) {
    if (!rule || typeof rule.id !== 'string') throw new Error('rule.id is required');
    if (typeof rule.apply !== 'function') throw new Error(`rule ${rule.id}: apply must be a function`);
    const prev = this.rules.get(rule.id) ?? null;
    const version = prev ? prev.version + 1 : 1;
    const stored = { priority: 0, requires: [], scope: null, ...rule, version };
    this.rules.set(rule.id, stored);
    this.events.push({ type: prev ? 'rule-rewritten' : 'rule-added', ruleId: rule.id, version });
    return { kind: prev ? 'rewritten' : 'added', version, prev };
  }

  get(id) {
    return this.rules.get(id) ?? null;
  }

  all() {
    return [...this.rules.values()];
  }
}
