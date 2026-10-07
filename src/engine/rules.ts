// 现有面纹推演规则的集合。
// 规则是纯函数：输入面纹本身、已就绪的依赖结论、活跃批注意见，输出判词与依据。
// 保持确定性（不读时间、不读随机数），使增量重推与全量重推结果必然一致。

import type { BasisEntry } from './types.ts'

export interface RuleInput {
  featureId: string
  featureName: string
  /** 已就绪依赖的判词：depFeatureId -> verdict */
  depVerdicts: Array<{ depId: string; depName: string; verdict: string }>
  /** 活跃批注意见（已按 seq、id 排序去重） */
  opinions: Array<{ annotationId: string; author: string; opinion: string }>
}

export interface RuleOutput {
  verdict: string
  basis: BasisEntry[]
}

interface FeatureRule {
  kind: string
  baseVerdict: string
  ruleName: string
}

const RULE_TABLE: FeatureRule[] = [
  { kind: 'forehead', ruleName: '天庭规制', baseVerdict: '天庭饱满，主早年运势亨通' },
  { kind: 'brow', ruleName: '眉宇规制', baseVerdict: '眉宇清朗，主心胸豁达、交友广阔' },
  { kind: 'eye', ruleName: '眼尾规制', baseVerdict: '眼尾微挑，主桃花渐旺而神采足' },
  { kind: 'nose', ruleName: '鼻准规制', baseVerdict: '鼻头圆润、山根丰隆，主财运亨通' },
  { kind: 'mouth', ruleName: '唇口规制', baseVerdict: '唇形端正，主口才出众、晚岁安稳' },
  { kind: 'ear', ruleName: '耳轮规制', baseVerdict: '耳轮贴脑，主福寿绵长、根基厚实' },
]

const DEFAULT_RULE: FeatureRule = {
  kind: 'default',
  ruleName: '常格规制',
  baseVerdict: '气色平和、部位周正，主运势平稳',
}

export function ruleFor(kind: string): FeatureRule {
  return RULE_TABLE.find((rule) => rule.kind === kind) ?? DEFAULT_RULE
}

/** 把依据整理成判词片段 */
function render(input: RuleInput, rule: FeatureRule): RuleOutput {
  const basis: BasisEntry[] = [
    { kind: 'rule', refId: rule.kind, text: `套用规则「${rule.ruleName}」` },
    { kind: 'feature', refId: input.featureId, text: `面纹：${input.featureName}` },
  ]
  const parts = [rule.baseVerdict]

  for (const dep of input.depVerdicts) {
    parts.push(`承「${dep.depName}」之象：${dep.verdict}`)
    basis.push({
      kind: 'dependency',
      refId: dep.depId,
      text: `引用依赖面纹「${dep.depName}」的结论`,
    })
  }

  for (const item of input.opinions) {
    parts.push(`众议（${item.author}）：${item.opinion}`)
    basis.push({
      kind: 'annotation',
      refId: item.annotationId,
      text: `采纳相士「${item.author}」批注：${item.opinion}`,
    })
  }

  return { verdict: parts.join('；'), basis }
}

/** 无冲突时：所有活跃批注共同参与；裁决后：只采纳裁决批注 */
export function applyRule(
  kind: string,
  input: RuleInput,
): RuleOutput {
  return render(input, ruleFor(kind))
}
