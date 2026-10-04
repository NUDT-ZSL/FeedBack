// 统一推演引擎的数据模型。
// 设计原则：所有结论（顺序、时刻、关键路径、排位依据）都能追溯到具体的来源声明与裁决记录。

export interface SourceRef {
  source: string; // 来源标识，如 "module:core"
  note?: string; // 来源说明
}

export interface TaskDecl extends SourceRef {
  taskId: string;
  duration: number;
  dependsOn?: string[]; // 硬依赖（前置任务）
  optionalDependsOn?: string[]; // 可选依赖：目标缺失时自动跳过并记录，不阻塞
}

export type Decision =
  | { type: 'select-duration'; taskId: string; source: string } // 耗时冲突：采纳某来源的耗时
  | { type: 'override-duration'; taskId: string; duration: number } // 耗时冲突：人工指定耗时
  | { type: 'drop-edge'; from: string; to: string } // 缺失/成环：放弃这条依赖边
  | { type: 'declare-external'; taskId: string; duration?: number }; // 缺失：把目标登记为外部任务（默认 0 耗时）

export interface BatchInput {
  name?: string;
  declarations: TaskDecl[];
  decisions?: Decision[];
}

export interface DurationClaim extends SourceRef {
  duration: number;
}

export interface EdgeClaim extends SourceRef {
  optional: boolean;
}

export interface MergedEdge {
  from: string;
  to: string;
  optional: boolean; // 所有声明都标可选才算可选
  claims: EdgeClaim[];
}

export interface MergedTask {
  id: string;
  durations: DurationClaim[]; // 全部来源的耗时声明（可能冲突，不静默择一）
  deps: MergedEdge[]; // 出边：本任务依赖谁
}

export interface MissingTargetIssue {
  kind: 'missing-target';
  id: string;
  from: string;
  to: string;
  optional: boolean;
  claims: EdgeClaim[];
  status: 'open' | 'resolved';
  resolution?: string;
}

export interface CycleIssue {
  kind: 'cycle';
  id: string;
  tasks: string[]; // 强连通分量
  displayCycle: string[]; // 便于阅读的一条环路
  status: 'open' | 'resolved';
  resolution?: string;
}

export interface DurationConflictIssue {
  kind: 'duration-conflict';
  id: string;
  taskId: string;
  claims: DurationClaim[];
  status: 'open' | 'resolved';
  resolution?: string;
}

export type Issue = MissingTargetIssue | CycleIssue | DurationConflictIssue;

export type BlockedReason = 'missing-target' | 'cycle' | 'duration-conflict' | 'upstream-blocked';

export interface PositionRationale {
  position: number; // 1-based
  readyAtPick: string[]; // 选取时同样就绪的候选
  reasons: string[]; // 人类可读的排位依据
}

export interface DerivedTask {
  id: string;
  duration: number;
  durationSource: string; // 该耗时来自哪条来源/裁决
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  slack: number;
  critical: boolean;
  startRationale: string[]; // 最早开始时刻的依据
  rationale?: PositionRationale; // 排位依据
}

export interface DerivedEdge {
  from: string;
  to: string;
  optional: boolean;
  claims: EdgeClaim[];
}

export interface SkippedEdge extends MergedEdge {
  reason: string;
}

export interface BlockedTask {
  id: string;
  reasons: BlockedReason[];
  detail: string;
}

export interface AppliedDecision {
  decision: Decision;
  effect: string;
}

export interface DeriveResult {
  inputName: string;
  fingerprint: string; // 输入（声明+裁决）的内容指纹，用于追溯一致性
  tasks: Record<string, DerivedTask>;
  edges: DerivedEdge[];
  skippedEdges: SkippedEdge[];
  order: string[]; // 合法构建顺序（拓扑序）
  projectDuration: number;
  criticalPaths: string[][]; // 全部最长路径
  criticalTasks: string[];
  issues: Issue[];
  blocked: BlockedTask[];
  appliedDecisions: AppliedDecision[];
  ignoredDecisions: { decision: Decision; reason: string }[];
  warnings: string[];
}
