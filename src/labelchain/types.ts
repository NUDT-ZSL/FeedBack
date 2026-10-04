/**
 * Auto16 可推演标记链路 —— 核心类型定义
 *
 * 链路：输入片段(含来源/顺序/修订号)
 *   -> 排序、去重、修订归并为带版本的位置序列
 *   -> 规则按作用范围匹配，保留全部命中候选
 *   -> 同优先级多结论形成可裁决冲突
 *   -> 沿依赖边传播，不动点迭代收敛
 *   -> 输出最终标记、依据、传播路径与未收敛/冲突清单
 */

/** 输入片段：source=来源，seq=来源内顺序，revision=修订号(越大越新) */
export interface Fragment {
  source: string;
  seq: number;
  revision: number;
  text: string;
}

/** 声明式匹配条件（可序列化为 JSON，保证样例可离线复现） */
export type MatchSpec =
  | { kind: 'charEq'; value: string }
  | { kind: 'charIn'; values: string[] }
  | { kind: 'regex'; pattern: string; window?: number }
  | { kind: 'depLabelEq'; value: string }
  | { kind: 'depLabelIn'; values: string[] }
  | { kind: 'all'; of: MatchSpec[] }
  | { kind: 'any'; of: MatchSpec[] }
  | { kind: 'not'; of: MatchSpec };

/** 规则定义：priority 越大越优先；scope 为闭区间位置范围；deps 为相对偏移 */
export interface RuleSpec {
  id: string;
  priority: number;
  scope: [number, number];
  match: MatchSpec;
  label: string;
  deps?: number[];
}

/** 位置（文档中一个字符） */
export interface Position {
  index: number;
  char: string;
  fragmentKey: string;
  revision: number;
}

/** 一次命中候选及其依据 */
export interface Candidate {
  ruleId: string;
  priority: number;
  label: string;
  /** 命中时读取到的依据文本（位置邻域） */
  evidence: string;
  /** 传播依据：读取过的依赖位置及其当时标记 */
  depInputs: Array<{ index: number; label: string | null }>;
}

export type PositionStatus =
  | 'resolved'
  | 'conflict'
  | 'pinned'
  | 'unconverged';

export interface PositionState {
  index: number;
  char: string;
  fragmentKey: string;
  label: string | null;
  status: PositionStatus;
  /** 该位置保留的全部命中候选（含未获胜方，冲突时是裁决依据） */
  candidates: Candidate[];
  /** 最近一次重推所在的迭代序号 */
  derivedAtPass: number;
  pinnedNote?: string;
}

export interface ConflictRecord {
  index: number;
  /** 同优先级但结论不同的各方候选 */
  tied: Candidate[];
  /** 该位置全部候选 */
  all: Candidate[];
}

export interface DanglingIssue {
  index: number;
  ruleId: string;
  target: number;
}

export interface IngestLogEntry {
  kind: 'accepted' | 'corrected' | 'duplicate' | 'revisionClash' | 'stale';
  fragmentKey: string;
  revision: number;
  note: string;
}

export interface ChangeSet {
  /** 本次实际重推的位置 */
  derived: number[];
  /** 重推后标记/状态确实变化的位置 */
  changed: number[];
  iterations: number;
  converged: boolean;
  /** 达到迭代上限仍未稳定（振荡）的位置 */
  unconverged: number[];
}

export interface Report {
  text: string;
  positions: PositionState[];
  conflicts: ConflictRecord[];
  unconverged: number[];
  cycles: number[][];
  dangling: DanglingIssue[];
  ingestLog: IngestLogEntry[];
}

/** 解释某位置最终标记时的传播路径节点 */
export interface ExplanationNode {
  index: number;
  char: string;
  label: string | null;
  status: PositionStatus;
  via: Array<{
    ruleId: string;
    priority: number;
    label: string;
    evidence: string;
    depInputs: ExplanationNode[];
  }>;
}
