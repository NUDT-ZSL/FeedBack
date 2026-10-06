/**
 * 太医署问诊推演 —— 核心类型定义
 *
 * 四诊（望/闻/问/切）采集记录、辨证结论、候选方剂、剂量配比、
 * 疗效预估均以纯数据结构描述，不依赖 React / DOM，可在 Node 下独立调用。
 */

/** 四诊采集类别：症状（问诊）、脉象（切诊）、舌象（望诊）、体质、既往病史 */
export type ObservationKind =
  | 'symptom'
  | 'pulse'
  | 'tongue'
  | 'constitution'
  | 'history';

/**
 * 采集记录状态：
 * - pending      已采集、尚未裁决（存在值冲突时不会参与辨证）
 * - adjudicated  经使用者裁决采纳
 * - rejected     经使用者裁决弃用
 */
export type RecordStatus = 'pending' | 'adjudicated' | 'rejected';

/**
 * 一条四诊采集记录。同一采集项（kind+key）被重复采集时不会覆盖，
 * 而是按来源与采集时刻追加为独立记录。
 */
export interface ObservationRecord {
  id: string;
  kind: ObservationKind;
  /** 采集项标识，如 pulse / tongue / headache */
  key: string;
  /** 采集值，如 浮脉、黄苔、present */
  value: string;
  /** 采集来源，如 望诊 / 闻诊 / 问诊 / 切诊 / 复诊 */
  source: string;
  /** 采集逻辑时刻（由调用方提供，引擎内部不取系统时间，保证可复现） */
  collectedAt: number;
  status: RecordStatus;
}

/** 值冲突分组：同一 kind+key 下出现互异的有效值时形成 */
export interface ConflictGroup {
  kind: ObservationKind;
  key: string;
  /** 按 collectedAt、id 确定性排序后的候选记录 */
  records: ObservationRecord[];
}

/** 单项加减分溯源 */
export interface Contribution {
  /** 来源节点，如 rec-001 / modifier:m-... */
  from: string;
  /** 可读说明 */
  detail: string;
  delta: number;
}

/** 证候判定结果 */
export interface SyndromeScore {
  syndromeId: string;
  name: string;
  /** 整数分值（所有权重均为整数，保证浮点结果可复现） */
  score: number;
  threshold: number;
  determined: boolean;
  contributions: Contribution[];
}

export type HerbRole = '君' | '臣' | '佐' | '使';

export interface HerbDose {
  name: string;
  role: HerbRole;
  /** 基础剂量（钱） */
  dose: number;
  /** 占全方总剂量的比例 0..1 */
  ratio: number;
}

/** 候选方剂（含剂量配比） */
export interface FormulaCandidate {
  formulaId: string;
  name: string;
  score: number;
  /** 命中的、已判定成立的证候 id */
  matchedSyndromes: string[];
  herbs: HerbDose[];
  totalDose: number;
}

export type ConfidenceLevel = '高' | '中' | '低';

/** 疗效回推结果 */
export interface EfficacyEstimate {
  formulaId: string;
  formulaName: string;
  /** 预估有效率 0..100 */
  expectedRate: number;
  /** 预估取效日数 */
  onsetDays: number;
  confidence: ConfidenceLevel;
  notes: string[];
}

/**
 * 推演诊断信息：依赖闭环、指向缺失、未裁决冲突均显式暴露，
 * 引擎不会静默跳过。
 */
export type Diagnostic =
  | {
      type: 'dependency-cycle';
      /** 参与闭环的节点（如 modifier / syndrome） */
      nodes: string[];
      detail: string;
    }
  | {
      type: 'missing-reference';
      from: string;
      target: string;
      detail: string;
    }
  | {
      type: 'unresolved-conflict';
      kind: ObservationKind;
      key: string;
      recordIds: string[];
      detail: string;
    };

/** 一次完整推演的输出 */
export interface InferenceResult {
  syndromes: SyndromeScore[];
  formulas: FormulaCandidate[];
  efficacy: EfficacyEstimate[];
  diagnostics: Diagnostic[];
  /** 实际参与辨证的采集记录 */
  activeRecordIds: string[];
  /** 因冲突未裁决而暂不参与辨证的记录 */
  withheldRecordIds: string[];
}

/** 推演输入：追加式的四诊记录 + 体质/病史 */
export interface CaseInput {
  records: ObservationRecord[];
}
