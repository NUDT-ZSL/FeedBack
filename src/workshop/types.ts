/**
 * 古籍修复工坊 —— 共享领域类型定义。
 *
 * 工序推进、材料领用、修复记录三个模块共用这一份类型与状态来源，
 * 任何模块读到的进度、材料余量、记录条数都派生自同一条操作日志。
 */

/** 修复工序（固定顺序，允许来回切换） */
export const PROCESS_STAGES = ['清点', '除尘', '修补', '装订', '验收'] as const
export type ProcessStage = (typeof PROCESS_STAGES)[number]

export interface BookInfo {
  id: string
  title: string
}

/** 工序列表展示字段 */
export interface StageTransitionView {
  from: ProcessStage | null
  to: ProcessStage
  at: number
  opId: string
}

export interface BookProgressView {
  bookId: string
  title: string
  currentStage: ProcessStage | null
  /** 已完成工序数（按当前工序在固定顺序中的位置推导，各模块一致） */
  completedStages: number
  totalStages: number
  history: StageTransitionView[]
}

/** 材料清单展示字段 */
export interface MaterialView {
  id: string
  name: string
  unit: string
  total: number
  remaining: number
}

export interface MaterialMovementView {
  materialId: string
  bookId: string
  stage: ProcessStage
  /** 领用为负、退回/迁移校正为正 */
  delta: number
  kind: 'checkout' | 'return' | 'migration'
  at: number
  opId: string
}

/** 修复记录展示字段 */
export interface RepairRecordView {
  id: string
  bookId: string
  stage: ProcessStage
  content: string
  at: number
}

/** 客户端提交的操作信封。opId 为幂等键，baseVersion 为乐观并发控制依据 */
export interface OperationRequest {
  opId: string
  bookId: string
  /** 提交方读到的该册书状态版本；提供时若与当前版本不一致则记为冲突 */
  baseVersion?: number
  at?: number
  payload:
    | { type: 'process.advance'; to: ProcessStage }
    | { type: 'material.checkout'; materialId: string; stage: ProcessStage; quantity: number }
    | { type: 'material.return'; materialId: string; stage: ProcessStage; quantity: number }
    | { type: 'record.append'; stage: ProcessStage; content: string; recordId?: string }
}

export type CommitStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected'

/** 冲突痕迹：被拒绝的冲突操作完整保留，可回溯当时生效的状态 */
export interface ConflictRecord {
  opId: string
  bookId: string
  expectedVersion: number
  actualVersion: number
  payload: OperationRequest['payload']
  at: number
}

export interface RejectionRecord {
  opId: string
  bookId: string
  reason: string
  payload: OperationRequest['payload']
  at: number
}

export interface CommitResult {
  status: CommitStatus
  opId: string
  bookId: string
  /** 提交后该册书的当前版本（冲突/拒绝时为未变化的版本） */
  version: number
  reason?: string
}

/** 已落账的事件（操作日志条目） */
export interface WorkshopEvent {
  opId: string
  bookId: string
  at: number
  /** 落账后该册书的版本号 */
  bookVersion: number
  payload:
    | { type: 'book.register'; title: string }
    | { type: 'material.define'; materialId: string; name: string; unit: string; total: number }
    | { type: 'process.advance'; to: ProcessStage }
    | { type: 'material.checkout'; materialId: string; stage: ProcessStage; quantity: number }
    | { type: 'material.return'; materialId: string; stage: ProcessStage; quantity: number }
    | { type: 'material.adjust'; materialId: string; delta: number; reason: string }
    | { type: 'record.append'; recordId: string; stage: ProcessStage; content: string }
}

/** 一册书的快照：三个模块的读取结果必须与此完全一致 */
export interface BookSnapshot {
  version: number
  progress: BookProgressView
  materials: MaterialView[]
  recordCount: number
  conflicts: ConflictRecord[]
}
