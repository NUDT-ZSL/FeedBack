/**
 * 古籍修复工坊 —— 状态一致性领域模型。
 *
 * 工序推进、材料领用、修复记录三个模块共享本文件定义的
 * 操作（Operation）与视图（View）类型，所有状态变更都以
 * 操作的形式追加到同一份操作日志（见 store.ts），
 * 各模块的读取结果都由该日志派生，保证任一操作发生后
 * 其他模块立即读到同一结果。
 */

/** 工序定义（修复工序的有序列表，顺序即推进方向） */
export interface StageDef {
  id: string;
  name: string;
}

/** 古籍（一册书） */
export interface BookDef {
  id: string;
  title: string;
  author: string;
}

/** 修复材料 */
export interface MaterialDef {
  id: string;
  name: string;
  unit: string;
  /** 初始库存，余量 = 初始库存 - 已领用 + 已退回（由日志派生） */
  initialStock: number;
}

/* ---------------- 操作（写入口） ---------------- */

export type OperationKind =
  | 'advance_stage'
  | 'requisition_material'
  | 'return_material'
  | 'add_record';

interface OperationBase {
  /** 客户端生成的幂等键：同一 opId 重复提交不会产生重复效果 */
  opId: string;
  bookId: string;
  /**
   * 提交方读取到的该册书当前版本号（乐观并发控制）。
   * 与当前版本不一致时操作不被应用，而是作为冲突保留痕迹。
   */
  expectedVersion: number;
  /** 操作人标识，用于冲突追溯 */
  actor: string;
}

export interface AdvanceStageOp extends OperationBase {
  kind: 'advance_stage';
  toStageId: string;
}

export interface RequisitionMaterialOp extends OperationBase {
  kind: 'requisition_material';
  materialId: string;
  quantity: number;
}

export interface ReturnMaterialOp extends OperationBase {
  kind: 'return_material';
  materialId: string;
  quantity: number;
}

export interface AddRecordOp extends OperationBase {
  kind: 'add_record';
  stageId: string;
  content: string;
}

export type Operation =
  | AdvanceStageOp
  | RequisitionMaterialOp
  | ReturnMaterialOp
  | AddRecordOp;

/* ---------------- 日志条目（可追溯的状态来源） ---------------- */

export type JournalStatus = 'applied' | 'conflict' | 'rejected';

export interface JournalEntry {
  /** 全局单调递增序号，决定生效顺序（先提交先生效） */
  seq: number;
  op: Operation;
  status: JournalStatus;
  /** 冲突/拒绝原因（applied 时为空） */
  reason?: string;
  /** 冲突时该册书的实际版本号（即生效状态所基于的版本） */
  actualVersion?: number;
}

/* ---------------- 读取视图（三个模块共享） ---------------- */

export interface StageTransition {
  seq: number;
  fromStageId: string | null;
  toStageId: string;
  actor: string;
}

/** 工序模块视图：当前进度 + 完整切换轨迹 */
export interface BookProgress {
  bookId: string;
  /** 该册书的版本号，每次生效操作 +1，用于乐观并发控制 */
  version: number;
  currentStageId: string | null;
  transitions: StageTransition[];
}

/** 材料模块视图：余量由领用/退回日志派生，工序切换不影响 */
export interface MaterialBalance {
  materialId: string;
  name: string;
  unit: string;
  initialStock: number;
  requisitioned: number;
  returned: number;
  /** 余量 = initialStock - requisitioned + returned */
  balance: number;
}

/** 修复记录模块视图 */
export interface RepairRecord {
  seq: number;
  bookId: string;
  stageId: string;
  content: string;
  actor: string;
}

/** 冲突痕迹：被版本冲突拦下的操作，保留完整上下文 */
export interface ConflictTrace {
  seq: number;
  op: Operation;
  reason: string;
  actualVersion: number;
}

/** 操作提交结果 */
export type OpResult =
  | { status: 'applied'; entry: JournalEntry; version: number }
  | { status: 'duplicate'; entry: JournalEntry; version: number }
  | { status: 'conflict'; entry: JournalEntry; version: number }
  | { status: 'rejected'; entry: JournalEntry; reason: string };
