/**
 * 陶器碎片拼合领域模型（纯 TypeScript，无 DOM / three.js 依赖）。
 * 数据流向：碎片集合 + 操作序列 -> 拼合引擎 -> 拼合结论（状态 + 进度 + 完成态 + 事件轨迹）。
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 碎片的目标拼合位姿（吸附判定基准） */
export interface ShardTarget {
  position: Vec3;
  rotationDeg: number;
}

export interface ShardGeometry {
  id: string;
  target: ShardTarget;
}

/** 一份碎片集合：陶器 id + 碎片几何 + 拼合依赖（shardId -> 前置碎片 id 列表） */
export interface ShardSet {
  vesselId: string;
  shards: ShardGeometry[];
  dependencies?: Record<string, string[]>;
}

/** 拼合操作：放置（拖拽释放）或移除 */
export type AssemblyOperation =
  | { kind: "place"; shardId: string; position: Vec3; rotationDeg: number }
  | { kind: "remove"; shardId: string };

export type ShardStatus = "pending" | "placed";

/** 吸附判定阈值：距离 1.5 单位、角度偏差 10 度 */
export const SNAP_DISTANCE = 1.5;
export const SNAP_ANGLE_DEG = 10;

export type AssemblyErrorCode =
  | "DUPLICATE_SHARD_ID"
  | "MISSING_DEPENDENCY"
  | "DEPENDENCY_CYCLE"
  | "UNKNOWN_SHARD";

export interface AssemblyError {
  code: AssemblyErrorCode;
  message: string;
  shardId?: string;
}

/** 拼合过程事件轨迹：进度与完成态必须能由事件流相互印证 */
export type AssemblyEvent =
  | { kind: "placed"; shardId: string; step: number }
  | {
      kind: "rejected";
      shardId: string;
      step: number;
      reason: "misaligned" | "unknown-shard" | "already-complete";
    }
  | { kind: "duplicate-ignored"; shardId: string; step: number }
  | { kind: "dependency-waiting"; shardId: string; step: number; waitingOn: string[] }
  | { kind: "removed"; shardId: string; step: number }
  | { kind: "remove-ignored"; shardId: string; step: number }
  | { kind: "completed"; step: number };

export interface ProgressSnapshot {
  placed: number;
  total: number;
  ratio: number;
}

/** 完成态结算：complete 为终态，settledAtStep 指向触发结算的操作序号 */
export interface CompletionState {
  complete: boolean;
  settledAtStep: number | null;
}

/** 拼合结论：任意入口对同一输入必须产出完全一致的结论 */
export interface AssemblyConclusion {
  vesselId: string;
  /** 碎片集合结构是否合法（依赖缺失/成环/重复 id 时为 false） */
  valid: boolean;
  shards: Record<string, ShardStatus>;
  progress: ProgressSnapshot;
  completion: CompletionState;
  events: AssemblyEvent[];
  errors: AssemblyError[];
}
