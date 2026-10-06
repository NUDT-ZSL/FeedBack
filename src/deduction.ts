import { ElementType } from './elements';
import {
  ConflictPair,
  RuleSet,
  ELEMENT_ORDER,
  elementLabel,
  isThresholdValid,
  pairKey,
  pairLabel
} from './rules';

export type Counts = Record<ElementType, number>;

export function emptyCounts(): Counts {
  return { fire: 0, water: 0, wind: 0, earth: 0, light: 0, dark: 0 };
}

export function countElements(types: ElementType[]): Counts {
  const counts = emptyCounts();
  for (const t of types) counts[t]++;
  return counts;
}

export type CountsMap = Partial<Record<ElementType, number>>;

export interface ReactionRef {
  kind: 'fusion' | 'conflict';
  id: string;
  label: string;
  element?: ElementType;
  pair?: ConflictPair;
  pairIndex?: number;
  priority: number;
}

export interface ResolvedReaction extends ReactionRef {
  consumed: CountsMap;
  reason: string;
}

export interface Resolution {
  reaction: ResolvedReaction | null;
  satisfied: ReactionRef[];
}

export function fusionId(element: ElementType): string {
  return `fusion:${element}`;
}

export function conflictId(pair: ConflictPair): string {
  return `conflict:${pair.id}`;
}

export function enumerateCandidates(rules: RuleSet): ReactionRef[] {
  const list: ReactionRef[] = [];
  if (isThresholdValid(rules.fusionThreshold)) {
    for (const element of ELEMENT_ORDER) {
      list.push({
        kind: 'fusion',
        id: fusionId(element),
        label: `融合：${rules.fusionThreshold} 个${elementLabel(element)}`,
        element,
        priority: list.length
      });
    }
  }
  rules.conflictPairs.forEach((pair, i) => {
    list.push({
      kind: 'conflict',
      id: conflictId(pair),
      label: `冲突：${pairLabel(pair)}`,
      pair,
      pairIndex: i,
      priority: list.length
    });
  });
  return list;
}

function requiredFor(ref: ReactionRef, rules: RuleSet): CountsMap {
  const need: CountsMap = {};
  if (ref.kind === 'fusion' && ref.element) {
    need[ref.element] = rules.fusionThreshold;
  } else if (ref.kind === 'conflict' && ref.pair) {
    const { a, b } = ref.pair;
    if (a === b) {
      need[a] = 2;
    } else {
      need[a] = 1;
      need[b] = 1;
    }
  }
  return need;
}

function isSatisfied(ref: ReactionRef, counts: Counts, rules: RuleSet): boolean {
  const need = requiredFor(ref, rules);
  return Object.entries(need).every(([el, n]) => counts[el as ElementType] >= (n as number));
}

export function resolveNextReaction(counts: Counts, rules: RuleSet): Resolution {
  const candidates = enumerateCandidates(rules);
  const satisfied = candidates.filter(ref => isSatisfied(ref, counts, rules));
  const winner = satisfied[0];
  if (!winner) return { reaction: null, satisfied };

  const consumed = requiredFor(winner, rules);
  const others = satisfied.slice(1);
  const why =
    `判定顺序固定为：① 融合（按 火→水→风→土→光→暗）② 冲突对（按列表自上而下）。` +
    `当前共有 ${satisfied.length} 条规则满足条件，本条排在最前（优先级 #${winner.priority + 1}）` +
    (others.length > 0 ? `，优先于：${others.slice(0, 3).map(o => o.label).join('、')}。` : '。');

  return {
    reaction: { ...winner, consumed, reason: why },
    satisfied
  };
}

export function missingFor(ref: ReactionRef, counts: Counts, rules: RuleSet): ElementType[] {
  const need = requiredFor(ref, rules);
  const result: ElementType[] = [];
  for (const [el, n] of Object.entries(need)) {
    const type = el as ElementType;
    const shortfall = (n as number) - counts[type];
    for (let i = 0; i < shortfall; i++) result.push(type);
  }
  return result;
}

export function applyConsumption(counts: Counts, consumed: CountsMap): Counts {
  const next = { ...counts };
  for (const [el, n] of Object.entries(consumed)) {
    const type = el as ElementType;
    next[type] = Math.max(0, next[type] - (n as number));
  }
  return next;
}

export interface DeductionStep {
  type: 'add' | 'reaction' | 'note';
  text: string;
  ruleId?: string;
}

export interface DeductionResult {
  targetId: string;
  targetLabel: string;
  success: boolean;
  needed: ElementType[];
  steps: DeductionStep[];
  reason: string;
}

export function findRef(rules: RuleSet, id: string): ReactionRef | null {
  return enumerateCandidates(rules).find(ref => ref.id === id) ?? null;
}

export function planTarget(initialCounts: Counts, rules: RuleSet, targetId: string): DeductionResult {
  const target = findRef(rules, targetId);
  if (!target) {
    return { targetId, targetLabel: '（规则不存在）', success: false, needed: [], steps: [], reason: '目标规则已被删除，无法推演。' };
  }

  const steps: DeductionStep[] = [];
  const needed: ElementType[] = [];
  let counts = { ...initialCounts };

  for (let iter = 0; iter < 32; iter++) {
    let resolution = resolveNextReaction(counts, rules);
    while (resolution.reaction) {
      const reaction = resolution.reaction;
      steps.push({
        type: 'reaction',
        ruleId: reaction.id,
        text: `触发「${reaction.label}」——${reaction.reason}`
      });
      if (reaction.id === targetId) {
        return {
          targetId,
          targetLabel: target.label,
          success: true,
          needed,
          steps,
          reason: '目标反应已触发，推演完成。'
        };
      }
      counts = applyConsumption(counts, reaction.consumed);
      resolution = resolveNextReaction(counts, rules);
    }

    const missing = missingFor(target, counts, rules);
    if (missing.length === 0) {
      return {
        targetId,
        targetLabel: target.label,
        success: false,
        needed,
        steps,
        reason: '投入材料已齐全，但目标反应仍未触发；该规则可能已失效（如阈值不可达）。'
      };
    }

    const nextElement = missing[0];
    counts[nextElement]++;
    needed.push(nextElement);
    steps.push({
      type: 'add',
      text: `再投入 1 个${elementLabel(nextElement)}（距目标还差 ${missing.length - 1} 个元素）`
    });
  }

  return {
    targetId,
    targetLabel: target.label,
    success: false,
    needed,
    steps,
    reason: '推演超过步数上限：投入的元素反复被优先级更高的反应消耗，目标在当前判定顺序下无法达成。'
  };
}

export function pairMatchKey(pair: ConflictPair): string {
  return pairKey(pair.a, pair.b);
}
