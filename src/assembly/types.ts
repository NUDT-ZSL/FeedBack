/**
 * 浑仪拆装步骤状态机 —— 纯数据类型定义。
 * 本目录（src/assembly/）不依赖 React / Three.js，可离线独立推演。
 */

/** 部件标识 */
export type PartId = string;

/** 部件静态定义：dependsOn 表示“拆解本部件前必须先拆下的部件”（即外层部件） */
export interface PartSpec {
  id: PartId;
  name: string;
  layer: string;
  dependsOn: PartId[];
}

/** 部件在生命周期中的挂载状态：在仪上 -> 已拆下 -> 已装回 */
export type MountState = 'installed' | 'removed' | 'assembled';

/** 拆装操作 */
export type OperationType = 'disassemble' | 'assemble';

export interface Operation {
  type: OperationType;
  partId: PartId;
}

/** 步骤类型：每个部件有“拆下”与“装回”两个步骤 */
export type StepKind = OperationType;

/** 步骤状态 */
export type StepStatus = 'ready' | 'blocked' | 'done';

/** 受阻原因（机器可读的稳定编码 + 中文说明） */
export type BlockReasonCode =
  | 'waiting-dependency'   // 前置部件尚未满足
  | 'dependency-cycle'     // 依赖成环，不可达
  | 'missing-dependency'   // 依赖指向不存在的部件，不可达
  | 'not-yet-disassembled' // 装回前尚未拆下
  | 'unknown-part'         // 操作指向不存在的部件
  | 'already-removed'      // 重复拆下
  | 'already-assembled';   // 重复装回

export interface BlockReason {
  code: BlockReasonCode;
  /** 相关的部件 id（未满足的依赖 / 环成员 / 缺失 id 等），按字典序排列保证稳定 */
  related: PartId[];
  message: string;
}

/** 单个步骤的推演结果 */
export interface StepState {
  partId: PartId;
  kind: StepKind;
  status: StepStatus;
  /** status === 'blocked' 时给出明确原因 */
  blockedBy: BlockReason | null;
}

/** 进度结论：仅由部件状态推导，不受无效操作影响 */
export interface Progress {
  total: number;
  disassembled: number; // 已拆下（含已装回）的部件数
  assembled: number;    // 已装回的部件数
  phase: 'disassembly' | 'assembly' | 'complete';
  /** 因依赖成环或缺失而不可达的部件 */
  unreachable: PartId[];
  complete: boolean;
  message: string;
}

/** 操作结果 */
export interface OperationOutcome {
  ok: boolean;
  /** ok === false 时的无效原因；状态与进度结论保持不变 */
  reason: BlockReason | null;
}

/** 一次操作后的完整推演快照（供界面与离线比对使用） */
export interface StepSnapshot {
  operation: Operation | null;
  outcome: OperationOutcome;
  mountStates: Record<PartId, MountState>;
  steps: StepState[];
  progress: Progress;
  /** 本次实际重推的部件集合（局部重推可观测证据），按字典序排列 */
  recomputed: PartId[];
}
