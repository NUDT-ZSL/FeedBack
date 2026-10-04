/** 一条任务声明：来自某个来源（模块/清单），带标识、依赖指向、耗时与来源说明。 */
export interface TaskDecl {
  id: string;
  dependsOn: string[];
  duration: number;
  source: string;
  /** 可选依赖：记录但不约束构建顺序与时刻。 */
  optionalDeps?: string[];
}

/** 使用者的裁决动作。 */
export type Resolution =
  | { kind: 'pick-duration'; taskId: string; source: string }
  | { kind: 'set-duration'; taskId: string; duration: number }
  | { kind: 'remove-dependency'; taskId: string; dep: string }
  | { kind: 'retarget-dependency'; taskId: string; dep: string; to: string };

export interface DurationConflict {
  type: 'duration-conflict';
  taskId: string;
  variants: { source: string; duration: number }[];
}

export interface MissingDependency {
  type: 'missing-dependency';
  taskId: string;
  dep: string;
  sources: string[];
}

export interface DependencyCycle {
  type: 'dependency-cycle';
  members: string[];
  edges: { from: string; to: string; sources: string[] }[];
}

export type Conflict = DurationConflict | MissingDependency | DependencyCycle;

export interface DepRef {
  id: string;
  sources: string[];
}

export interface TaskResult {
  id: string;
  /** 生效耗时；null 表示耗时冲突未裁决。 */
  duration: number | null;
  /** 生效耗时来自哪些来源。 */
  durationSources: string[];
  durationConflict: boolean;
  /** 生效硬依赖（目标存在、未被裁决移除）。 */
  deps: DepRef[];
  /** 可选依赖（不约束顺序）。 */
  optionalDeps: DepRef[];
  /** 指向不存在任务的依赖，保留待裁决。 */
  missingDeps: DepRef[];
  est: number | null;
  finish: number | null;
  /** 决定 est 的依赖（可能多个，取等值最大者）。 */
  gatedBy: string[];
  /** 在就绪集合中与本任务同时就绪的其它任务（解释排序依据）。 */
  readyWith: string[];
  orderIndex: number | null;
  onCriticalPath: boolean;
  unscheduledReason: string | null;
}

export interface DerivationResult {
  order: string[];
  tasks: Record<string, TaskResult>;
  /** 裁决后仍存在的冲突。 */
  conflicts: Conflict[];
  criticalPath: string[];
  makespan: number | null;
}

export interface Explanation {
  taskId: string;
  scheduled: boolean;
  orderIndex: number | null;
  est: number | null;
  finish: number | null;
  onCriticalPath: boolean;
  reasons: string[];
}
