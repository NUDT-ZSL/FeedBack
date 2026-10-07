/**
 * 太医署问诊推演领域类型。
 *
 * 整条推演链路（四诊采集 -> 裁决 -> 辨证 -> 方剂排序 -> 剂量配比 -> 疗效预估）
 * 只依赖本文件中的纯数据类型，不依赖 React / DOM / 网络 / 时钟，
 * 因此同一份输入在任意入口、任意时刻推演都得到同一份结果。
 */

/** 四诊来源：望、闻、问、切（对应不同采集入口）。 */
export type ExamSource = 'wang' | 'wen' | 'wenwen' | 'qie';

/** 采集类别。 */
export type RecordKind =
  | 'symptom' // 症状（如头痛、咳嗽）
  | 'pulse' // 脉象（如浮、数）
  | 'tongue' // 舌苔（如白苔、黄苔）
  | 'constitution' // 体质（如阳虚、痰湿）
  | 'history'; // 既往病史（如肺疾、胃疾）

/**
 * 一条四诊采集记录。
 * 同一症状/脉象被重复采集时不会相互覆盖：每次采集都是独立记录，
 * 通过 source（入口）、seq（采集次序）与 recordedAt（调用方提供的逻辑时刻）区分。
 */
export interface CollectionRecord {
  id: string;
  kind: RecordKind;
  /** 采集项标识，如 symptom:headache / pulse:floating / constitution:yangxu。 */
  key: string;
  /** 采集到的取值，如 true / 'severe'，不同取值构成冲突。 */
  value: string;
  source: ExamSource;
  /** 调用方提供的逻辑时刻；引擎本身不读系统时钟。 */
  recordedAt: number;
  /** 同一逻辑时刻下的次序，用于稳定排序。 */
  seq: number;
  /** 备注（如问诊时的补充描述），不参与推演，仅用于展示与追溯。 */
  note?: string;
}

/** 两个同 key 记录取值不一致时构成的冲突，保留全部来源供使用者裁决。 */
export interface CollectionConflict {
  kind: RecordKind;
  key: string;
  /** 参与冲突的全部记录（按 recordedAt, seq 稳定排序）。 */
  records: CollectionRecord[];
  /** 已裁决采用的记录 id；未裁决为 null。 */
  resolvedRecordId: string | null;
}

/** 裁决/修正动作：决定某个采集项采用哪一条记录，或忽略该项。 */
export type Adjudication =
  | { key: string; kind: RecordKind; decision: 'pick'; recordId: string }
  | { key: string; kind: RecordKind; decision: 'ignore' };

/** 参与辨证的解析后输入：每个采集项只有一个生效取值。 */
export interface ResolvedFinding {
  kind: RecordKind;
  key: string;
  value: string;
  /** 取值来自哪一条采集记录，保证可追溯。 */
  sourceRecordId: string;
}

export interface ResolvedInputs {
  findings: Record<string, ResolvedFinding>;
  symptoms: string[];
  pulses: string[];
  tongues: string[];
  constitutions: string[];
  histories: string[];
}

/** 依赖问题类型：依赖闭环 / 指向缺失。 */
export type DependencyIssueType = 'dependency_cycle' | 'missing_reference';

export interface DependencyIssue {
  type: DependencyIssueType;
  /** 涉及的规则节点（体质/病史/证候 id）。 */
  nodes: string[];
  message: string;
}

export type SyndromeStatus = 'concluded' | 'blocked';

/** 单个证候的判定结果。 */
export interface SyndromeConclusion {
  syndromeId: string;
  name: string;
  /** blocked：该证候参与依赖闭环或规则指向缺失，不静默跳过而是明确暴露。 */
  status: SyndromeStatus;
  /** 证据得分，确定性计算；blocked 时为 0。 */
  score: number;
  /** 判定阈值，score >= threshold 即成立。 */
  threshold: number;
  /** 成立的证据（症状/脉象/舌苔 key），用于展示与增量索引。 */
  evidence: string[];
  /** 体质/病史对本证候施加的加权明细。 */
  modifiers: { id: string; delta: number; reason: string }[];
  blockReason?: string;
}

export interface FormulaCandidate {
  formulaId: string;
  name: string;
  rank: number;
  /** 与证候集合的匹配分。 */
  matchScore: number;
  /** 命中的主治证候 id。 */
  matchedSyndromes: string[];
  /** 命中的禁忌（病史/体质），会显著扣分并提示。 */
  contraindications: string[];
  /** 入选理由（确定性文本，供界面展示）。 */
  reasons: string[];
}

/** 单味药的配比。 */
export interface HerbDosage {
  herbId: string;
  name: string;
  role: 'jun' | 'chen' | 'zuo' | 'shi';
  /** 基准剂量（克）。 */
  baseGrams: number;
  /** 体质/病史修正系数。 */
  factor: number;
  /** 最终剂量（克），按规则取整到 0.5 克。 */
  grams: number;
  /** 剂量调整说明。 */
  adjustment?: string;
}

export interface FormulaDosage {
  formulaId: string;
  name: string;
  composition: HerbDosage[];
  /** 全方寒热偏向（负寒正热），来自固定药性数据。 */
  natureBias: number;
}

export interface EfficacyEstimate {
  formulaId: string;
  name: string;
  /** 预估有效率 0-100，确定性计算并四舍五入到 1%。 */
  effectiveRate: number;
  /** 预估疗程（剂）。 */
  estimatedCourses: number;
  /** 体质相合度 0-100。 */
  constitutionFit: number;
  /** 病史风险说明（无风险为空数组）。 */
  riskNotes: string[];
  /** 疗效预估的依据明细。 */
  rationale: string[];
}

/** 一次完整推演的输出。 */
export interface DeductionResult {
  syndromes: SyndromeConclusion[];
  formulas: FormulaCandidate[];
  dosages: FormulaDosage[];
  efficacy: EfficacyEstimate[];
  conflicts: CollectionConflict[];
  dependencyIssues: DependencyIssue[];
}
