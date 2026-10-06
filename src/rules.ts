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
  conflictPairs: ConflictPair[];
}

export const MIN_FUSION_THRESHOLD = 2;
export const MAX_FUSION_THRESHOLD = 8;

export const ELEMENT_ORDER: ElementType[] = ['fire', 'water', 'wind', 'earth', 'light', 'dark'];

export function newPairId(): string {
  return 'pair_' + Math.random().toString(36).slice(2, 10);
}

export function pairKey(a: ElementType, b: ElementType): string {
  return [a, b].sort().join('|');
}

export function isThresholdValid(t: number): boolean {
  return Number.isInteger(t) && t >= MIN_FUSION_THRESHOLD && t <= MAX_FUSION_THRESHOLD;
}

export function createDefaultRules(): RuleSet {
  return {
    fusionThreshold: 3,
    conflictPairs: [
      { id: newPairId(), a: 'water', b: 'fire', reaction: '水与火碰撞，产生浓密的蒸汽云', color: '#ffffff' },
      { id: newPairId(), a: 'wind', b: 'earth', reaction: '风与土交汇，卷起漫天沙尘暴', color: '#d4a54a' },
      { id: newPairId(), a: 'light', b: 'dark', reaction: '光与暗交融，形成黑洞漩涡', color: '#9932cc' }
    ]
  };
}

export function cloneRules(rules: RuleSet): RuleSet {
  return {
    fusionThreshold: rules.fusionThreshold,
    conflictPairs: rules.conflictPairs.map(p => ({ ...p }))
  };
}

export function elementLabel(t: ElementType): string {
  return ELEMENT_CONFIGS[t].nameCN;
}

export function pairLabel(pair: ConflictPair): string {
  return `${elementLabel(pair.a)} × ${elementLabel(pair.b)}`;
}

export interface RuleIssue {
  level: 'warn' | 'error';
  message: string;
}

export function validateRuleSet(rules: RuleSet): RuleIssue[] {
  const issues: RuleIssue[] = [];

  if (!isThresholdValid(rules.fusionThreshold)) {
    issues.push({
      level: 'error',
      message: `融合阈值「${rules.fusionThreshold}」无法达成：需为 ${MIN_FUSION_THRESHOLD}–${MAX_FUSION_THRESHOLD} 的整数，融合反应已停用`
    });
  }

  const seen = new Map<string, number>();
  rules.conflictPairs.forEach((pair, i) => {
    const pos = i + 1;
    if (pair.a === pair.b) {
      issues.push({
        level: 'warn',
        message: `冲突对 #${pos}（${pairLabel(pair)}）是自反对：已保留，需要 2 个${elementLabel(pair.a)}同时在场才会触发`
      });
    }
    const key = pairKey(pair.a, pair.b);
    if (seen.has(key)) {
      issues.push({
        level: 'warn',
        message: `冲突对 #${pos} 与 #${seen.get(key)!} 重复（${pairLabel(pair)}）：两条都保留，判定顺序靠前的先生效`
      });
    } else {
      seen.set(key, pos);
    }
  });

  if (rules.conflictPairs.length === 0 && !isThresholdValid(rules.fusionThreshold)) {
    issues.push({
      level: 'error',
      message: '规则集为空：没有冲突对且融合不可用，投入元素不会触发任何反应'
    });
  } else if (rules.conflictPairs.length === 0) {
    issues.push({
      level: 'warn',
      message: '当前没有任何冲突对，只有融合反应可用'
    });
  }

  return issues;
}
