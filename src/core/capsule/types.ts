/**
 * 虚拟时间胶囊核心领域类型。
 * 该模块不依赖任何前端/后端框架，可在 Node 环境下离线运行与测试。
 */

/** 派生状态：sealed=锁定未到期, deliverable=可开启, opened=已开启 */
export type CapsuleStatus = 'sealed' | 'deliverable' | 'opened'

/** 持久化状态只会前进不会回退：opened 一旦置位不可撤销 */
export type PersistedStatus = 'sealed' | 'opened'

export type UnlockCondition =
  | { type: 'none' }
  /** 需要解锁时提供匹配口令（存储 SHA-256 哈希，不存明文） */
  | { type: 'passphrase'; hash: string }
  /** 除投递时间外，还需到达额外的开启时间点（含边界） */
  | { type: 'after'; notBefore: number }

export interface Capsule {
  id: string
  title: string
  content: string
  /** 投递时间（epoch ms）。now >= deliverAt 时才可能解锁 */
  deliverAt: number
  unlockCondition: UnlockCondition
  /** 持久化状态，仅允许 sealed -> opened 单向迁移 */
  status: PersistedStatus
  /** 乐观并发版本号，每次成功变更 +1，从 1 开始 */
  version: number
  createdAt: number
  updatedAt: number
  /** 解锁时刻；一旦写入永不清空，保证状态不回退 */
  openedAt: number | null
  /** 已应用的操作 ID 日志，用于重复提交去重（幂等） */
  appliedOperations: string[]
}

export interface CreateCapsuleInput {
  id?: string
  title: string
  content: string
  deliverAt: number
  unlockCondition?: UnlockCondition
  /** 调用方提供的幂等键；相同 operationId 重复提交不会重复生效 */
  operationId?: string
}

export interface EditCapsuleInput {
  /** 必须等于当前版本号，否则视为冲突并拒绝，绝不静默择一 */
  expectedVersion: number
  title?: string
  content?: string
  deliverAt?: number
  unlockCondition?: UnlockCondition
  operationId?: string
}

export interface UnlockInput {
  passphrase?: string
  operationId?: string
}
