// 推演台领域模型：面纹、批注、裁决、结论与问题暴露。
// 纯数据结构，无 DOM / React 依赖，可同时在浏览器与离线 Node 批处理中使用。

/** 面纹（宾客面部特征）录入条目 */
export interface FeatureRecord {
  /** 面纹唯一标识，如 `yintang` */
  id: string
  /** 面纹名称，如“印堂” */
  name: string
  /** 部位类别，决定套用哪条推演规则，如 `forehead` */
  kind: string
  /** 量化特征描述（眉间距、额头占比等录入依据） */
  observation: string
  /** 推导依赖的其他面纹 id（面纹之间的引用关系） */
  dependsOn: string[]
  /** 是否撤回。撤回后的面纹不再推演，引用它的面纹会被显式标为问题 */
  withdrawn: boolean
  /** 录入序号，保证顺序稳定 */
  seq: number
}

/** 相士针对某条面纹给出的来源批注 */
export interface Annotation {
  id: string
  /** 批注指向的面纹（可能不存在或已撤回，需要显式暴露） */
  targetFeatureId: string
  /** 相士名号 */
  author: string
  /** 批注意见，会参与面纹结论推演 */
  opinion: string
  /** 是否撤回；撤回后不参与推演，但记录保留 */
  withdrawn: boolean
  /** 录入顺序，裁决与推演时按此排序，保证确定性 */
  seq: number
}

/** 对同一面纹冲突批注的裁决 */
export interface Adjudication {
  featureId: string
  /** 被采纳的批注 id */
  chosenAnnotationId: string
  /** 裁决说明 */
  note: string
  /** 裁决序号 */
  seq: number
}

/** 单条面纹的推演结论 */
export interface Conclusion {
  featureId: string
  /** ready 表示结论已推出；其余状态下 verdict 为 null，依据中说明原因 */
  status:
    | 'ready'
    | 'conflict-pending'
    | 'blocked-cycle'
    | 'blocked-missing-dependency'
    | 'blocked-withdrawn-dependency'
  /** 推演判词；无法推出时为 null，绝不返回错误结论 */
  verdict: string | null
  /** 结论依据：所用规则、依赖面纹、批注、裁决与阻塞原因 */
  basis: BasisEntry[]
  /** 参与本结论的批注 id（活跃） */
  annotationIds: string[]
  /** 若经裁决，记录采纳的批注 id */
  adjudicatedAnnotationId: string | null
}

export interface BasisEntry {
  kind: 'rule' | 'feature' | 'dependency' | 'annotation' | 'adjudication' | 'reason'
  refId?: string
  text: string
}

/** 推演台上必须显式暴露的问题，绝不静默跳过 */
export interface BenchIssue {
  code:
    | 'annotation-target-missing'
    | 'annotation-target-withdrawn'
    | 'annotation-withdrawn-adjudicated'
    | 'dependency-missing'
    | 'dependency-withdrawn'
    | 'dependency-cycle'
  /** 触发问题的主体 id（批注 / 面纹） */
  sourceId: string
  /** 关联对象 id（缺失面纹 / 闭环成员等） */
  relatedId?: string
  text: string
  /** 闭环时为整个环路上的面纹 id 有序列表 */
  cyclePath?: string[]
}

/** 一次（全量或增量）推演的结果 */
export interface DerivationResult {
  conclusions: Record<string, Conclusion>
  issues: BenchIssue[]
  /** 本次推演版本号，随输入变更递增 */
  version: number
}

/** 随结论一起落档 / 导出的完整推演台数据 */
export interface ArchiveBundle {
  format: 'xiangmian-ge-bench/v1'
  exportedAt: string
  features: FeatureRecord[]
  annotations: Annotation[]
  adjudications: Adjudication[]
  derivation: DerivationResult
}
