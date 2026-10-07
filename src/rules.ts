import { ElementType, ELEMENT_CONFIGS } from './elements';

export interface ConflictPair {
  id: string;
  a: ElementType;
  b: ElementType;
  reaction: string;
  color: string;
}

export interface RuleSet {
  fusionThreshold: number;
  pairs: ConflictPair[];
}

export const ELEMENT_ORDER: ElementType[] = ['fire', 'water', 'wind', 'earth', 'light', 'dark'];

export type Counts = Record<ElementType, number>;

export function emptyCounts(): Counts {
  return { fire: 0, water: 0, wind: 0, earth: 0, light: 0, dark: 0 };
}

export function elementName(type: ElementType): string {
  return ELEMENT_CONFIGS[type].nameCN;
}

let pairSeq = 0;

export function makePair(a: ElementType, b: ElementType, reaction = '', color = '#ffffff'): ConflictPair {
  pairSeq += 1;
  return { id: `pair-${Date.now().toString(36)}-${pairSeq}`, a, b, reaction, color };
}

export function defaultRules(): RuleSet {
  return {
    fusionThreshold: 3,
    pairs: [
      makePair('water', 'fire', '水与火碰撞，产生浓密的蒸汽云', '#ffffff'),
      makePair('wind', 'earth', '风与土交汇，卷起漫天沙尘暴', '#d4a54a'),
      makePair('light', 'dark', '光与暗交融，形成黑洞漩涡', '#9932cc')
    ]
  };
}

export function pairKey(a: ElementType, b: ElementType): string {
  return [a, b].sort().join('|');
}

export function pairLabel(a: ElementType, b: ElementType): string {
  return `${elementName(a)}×${elementName(b)}`;
}

const FUSION_TEMPLATES: Record<ElementType, string> = {
  fire: '{n}火合一，召唤出火焰精灵！',
  water: '{n}水凝结，生成璀璨冰晶！',
  wind: '{n}风凝聚，形成旋风风暴！',
  earth: '{n}土聚合，凝聚成坚硬巨石！',
  light: '{n}光合聚，绽放神圣光芒！',
  dark: '{n}暗融合，诞生幽暗深渊！'
};

const FUSION_COLORS: Record<ElementType, string> = {
  fire: '#ff6600',
  water: '#88ddff',
  wind: '#3cb371',
  earth: '#8b5a2b',
  light: '#fffacd',
  dark: '#8a2be2'
};

export function fusionText(type: ElementType, n: number): string {
  return FUSION_TEMPLATES[type].replace('{n}', String(n));
}

export function fusionColor(type: ElementType): string {
  return FUSION_COLORS[type];
}

export function isValidThreshold(threshold: number): boolean {
  return Number.isInteger(threshold) && threshold >= 1;
}

// ---------- 校验 ----------

export interface RuleWarning {
  kind: 'duplicate' | 'reflexive' | 'threshold';
  pairIds: string[];
  message: string;
}

export function validateRules(rules: RuleSet): RuleWarning[] {
  const warnings: RuleWarning[] = [];

  if (!isValidThreshold(rules.fusionThreshold)) {
    warnings.push({
      kind: 'threshold',
      pairIds: [],
      message: `融合阈值「${rules.fusionThreshold}」无效（需为 ≥1 的整数），融合规则已停用`
    });
  } else if (rules.fusionThreshold > 10) {
    warnings.push({
      kind: 'threshold',
      pairIds: [],
      message: `融合阈值 ${rules.fusionThreshold} 过高，需要同时投入 ${rules.fusionThreshold} 个同元素，实际实验中几乎无法达成`
    });
  }

  const groups = new Map<string, ConflictPair[]>();
  for (const pair of rules.pairs) {
    if (pair.a === pair.b) {
      warnings.push({
        kind: 'reflexive',
        pairIds: [pair.id],
        message: `冲突对「${pairLabel(pair.a, pair.b)}」是同一元素自配对，需要坩埚内同时存在 2 个${elementName(pair.a)}才会触发`
      });
    }
    const key = pairKey(pair.a, pair.b);
    const group = groups.get(key);
    if (group) group.push(pair);
    else groups.set(key, [pair]);
  }
  for (const group of groups.values()) {
    if (group.length > 1) {
      warnings.push({
        kind: 'duplicate',
        pairIds: group.map(p => p.id),
        message: `冲突对「${pairLabel(group[0].a, group[0].b)}」重复出现 ${group.length} 次，判定顺序靠前的一条会优先生效，其余仅作保留`
      });
    }
  }

  return warnings;
}

// ---------- 规则引用与触发判定 ----------

export interface RuleRef {
  kind: 'fusion' | 'conflict';
  element?: ElementType;
  pairId?: string;
  label: string;
  priority: number;
}

export interface TriggerResult {
  rule: RuleRef;
  consume: Counts;
  result: string;
  color: string;
  reason: string;
}

export function fusionRuleRef(rules: RuleSet, type: ElementType): RuleRef {
  return {
    kind: 'fusion',
    element: type,
    label: `融合·${elementName(type)}×${rules.fusionThreshold}`,
    priority: ELEMENT_ORDER.indexOf(type)
  };
}

export function conflictRuleRef(pair: ConflictPair, index: number): RuleRef {
  return {
    kind: 'conflict',
    pairId: pair.id,
    label: `冲突对#${index + 1} ${pairLabel(pair.a, pair.b)}`,
    priority: ELEMENT_ORDER.length + index
  };
}

export function ruleRefId(ref: RuleRef): string {
  return ref.kind === 'fusion' ? `fusion:${ref.element}` : `conflict:${ref.pairId}`;
}

export function sameRule(a: RuleRef, b: RuleRef): boolean {
  return ruleRefId(a) === ruleRefId(b);
}

function matchFusion(rules: RuleSet, counts: Counts): TriggerResult[] {
  if (!isValidThreshold(rules.fusionThreshold)) return [];
  const out: TriggerResult[] = [];
  for (const type of ELEMENT_ORDER) {
    if (counts[type] >= rules.fusionThreshold) {
      const consume = emptyCounts();
      consume[type] = rules.fusionThreshold;
      out.push({
        rule: fusionRuleRef(rules, type),
        consume,
        result: fusionText(type, rules.fusionThreshold),
        color: fusionColor(type),
        reason: ''
      });
    }
  }
  return out;
}

function matchConflicts(rules: RuleSet, counts: Counts): TriggerResult[] {
  const out: TriggerResult[] = [];
  rules.pairs.forEach((pair, index) => {
    const reflexive = pair.a === pair.b;
    const ok = reflexive
      ? counts[pair.a] >= 2
      : counts[pair.a] >= 1 && counts[pair.b] >= 1;
    if (!ok) return;
    const consume = emptyCounts();
    consume[pair.a] += 1;
    consume[pair.b] += 1;
    out.push({
      rule: conflictRuleRef(pair, index),
      consume,
      result: pair.reaction || `${pairLabel(pair.a, pair.b)} 发生反应`,
      color: pair.color,
      reason: ''
    });
  });
  return out;
}

export function allMatches(rules: RuleSet, counts: Counts): TriggerResult[] {
  return [...matchFusion(rules, counts), ...matchConflicts(rules, counts)];
}

export function findTrigger(rules: RuleSet, counts: Counts): TriggerResult | null {
  const matches = allMatches(rules, counts);
  if (matches.length === 0) return null;
  const chosen = matches[0];
  const others = matches.slice(1).map(m => m.rule.label);
  chosen.reason =
    `按判定顺序（先融合后冲突，同组按列表先后），「${chosen.rule.label}」是第一条满足条件的规则` +
    (others.length > 0 ? `；同时满足但被其压制的还有：${others.join('、')}` : '');
  return chosen;
}

// ---------- 推演 ----------

export interface DeductionStep {
  kind: 'add' | 'trigger';
  text: string;
  counts: Counts;
}

export interface DeductionResult {
  reachable: boolean;
  reason: string;
  steps: DeductionStep[];
  needed: Counts;
  usedRules: string[];
}

const MAX_DEDUCTION_STEPS = 80;

export function deduce(rules: RuleSet, start: Counts, target: RuleRef): DeductionResult {
  const counts = { ...start };
  const needed = emptyCounts();
  const steps: DeductionStep[] = [];
  const usedRules: string[] = [];

  const fail = (reason: string): DeductionResult => ({ reachable: false, reason, steps, needed, usedRules });

  if (target.kind === 'fusion') {
    if (!isValidThreshold(rules.fusionThreshold)) {
      return fail(`融合阈值「${rules.fusionThreshold}」无效，目标「${target.label}」不可达`);
    }
  } else {
    const idx = rules.pairs.findIndex(p => p.id === target.pairId);
    if (idx === -1) return fail('目标冲突对规则已不存在');
    const targetPair = rules.pairs[idx];
    const shadow = rules.pairs
      .slice(0, idx)
      .find(p => pairKey(p.a, p.b) === pairKey(targetPair.a, targetPair.b));
    if (shadow) {
      return fail(
        `目标「${target.label}」与排在前面的「${conflictRuleRef(shadow, rules.pairs.indexOf(shadow)).label}」重复，` +
        `每次条件满足时都会被对方抢先触发，因此永远无法命中，请删除重复项或调整顺序`
      );
    }
  }

  for (let i = 0; i < MAX_DEDUCTION_STEPS; i++) {
    const trigger = findTrigger(rules, counts);
    if (trigger && sameRule(trigger.rule, target)) {
      steps.push({
        kind: 'trigger',
        text: `触发目标「${trigger.rule.label}」：${trigger.result}`,
        counts: { ...counts }
      });
      if (!usedRules.includes(trigger.rule.label)) usedRules.push(trigger.rule.label);
      return { reachable: true, reason: '', steps, needed, usedRules };
    }
    if (trigger) {
      steps.push({
        kind: 'trigger',
        text: `优先触发「${trigger.rule.label}」（判定顺序先于目标），消耗 ${formatCounts(trigger.consume)} 后继续`,
        counts: { ...counts }
      });
      if (!usedRules.includes(trigger.rule.label)) usedRules.push(trigger.rule.label);
      for (const type of ELEMENT_ORDER) counts[type] -= trigger.consume[type];
      continue;
    }
    const add = nextAddition(rules, counts, target);
    if (!add) return fail('无法确定下一步投入，目标不可达');
    counts[add] += 1;
    needed[add] += 1;
    steps.push({
      kind: 'add',
      text: `投入 ${elementName(add)}（坩埚：${formatCounts(counts)}）`,
      counts: { ...counts }
    });
  }

  return fail(`推演超过 ${MAX_DEDUCTION_STEPS} 步仍未命中目标，目标可能被更高优先级规则持续拦截`);
}

function nextAddition(rules: RuleSet, counts: Counts, target: RuleRef): ElementType | null {
  if (target.kind === 'fusion') {
    return target.element ?? null;
  }
  const pair = rules.pairs.find(p => p.id === target.pairId);
  if (!pair) return null;
  if (pair.a === pair.b) return pair.a;
  if (counts[pair.a] === 0) return pair.a;
  if (counts[pair.b] === 0) return pair.b;
  return pair.a;
}

export function formatCounts(counts: Counts): string {
  const parts = ELEMENT_ORDER.filter(t => counts[t] > 0).map(t => `${elementName(t)}×${counts[t]}`);
  return parts.length > 0 ? parts.join('、') : '空';
}

// ---------- 快照 ----------

export interface Snapshot {
  name: string;
  createdAt: number;
  rules: RuleSet;
}

const STORAGE_KEY = 'element-lab-rule-snapshots-v1';

export function loadSnapshots(): Snapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Snapshot[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(s => s && typeof s.name === 'string' && s.rules && Array.isArray(s.rules.pairs));
  } catch {
    return [];
  }
}

export function persistSnapshots(snapshots: Snapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // 存储不可用时静默失败，快照仅在内存中生效
  }
}

export interface PairModification {
  before: ConflictPair;
  after: ConflictPair;
  changes: string[];
}

export interface RulesDiff {
  threshold: { from: number; to: number } | null;
  addedPairs: ConflictPair[];
  removedPairs: ConflictPair[];
  modifiedPairs: PairModification[];
}

export function diffRules(a: RuleSet, b: RuleSet): RulesDiff {
  const diff: RulesDiff = {
    threshold: a.fusionThreshold === b.fusionThreshold
      ? null
      : { from: a.fusionThreshold, to: b.fusionThreshold },
    addedPairs: [],
    removedPairs: [],
    modifiedPairs: []
  };

  const groupByKey = (pairs: ConflictPair[]): Map<string, ConflictPair[]> => {
    const map = new Map<string, ConflictPair[]>();
    for (const p of pairs) {
      const key = pairKey(p.a, p.b);
      const group = map.get(key);
      if (group) group.push(p);
      else map.set(key, [p]);
    }
    return map;
  };

  const groupA = groupByKey(a.pairs);
  const groupB = groupByKey(b.pairs);
  const keys = new Set([...groupA.keys(), ...groupB.keys()]);

  for (const key of keys) {
    const listA = groupA.get(key) ?? [];
    const listB = groupB.get(key) ?? [];
    const common = Math.min(listA.length, listB.length);
    for (let i = 0; i < common; i++) {
      const changes: string[] = [];
      if (listA[i].reaction !== listB[i].reaction) changes.push('文案');
      if (listA[i].color !== listB[i].color) changes.push('颜色');
      if (changes.length > 0) {
        diff.modifiedPairs.push({ before: listA[i], after: listB[i], changes });
      }
    }
    for (let i = common; i < listA.length; i++) diff.removedPairs.push(listA[i]);
    for (let i = common; i < listB.length; i++) diff.addedPairs.push(listB[i]);
  }

  return diff;
}
