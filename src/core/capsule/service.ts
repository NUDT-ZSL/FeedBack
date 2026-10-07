import { createHash, randomUUID } from 'node:crypto'
import type { Clock } from './clock.ts'
import type {
  Capsule,
  CapsuleStatus,
  CreateCapsuleInput,
  EditCapsuleInput,
  UnlockCondition,
  UnlockInput,
} from './types.ts'

export type CapsuleErrorCode =
  | 'NOT_FOUND'
  | 'LOCKED_BEFORE_DELIVERY'
  | 'CONDITION_NOT_MET'
  | 'VERSION_CONFLICT'
  | 'INVALID_INPUT'
  | 'ALREADY_OPENED'

export class CapsuleError extends Error {
  readonly code: CapsuleErrorCode
  /** 对 LOCKED_BEFORE_DELIVERY 附带可重试时间点 */
  readonly retryAt?: number

  constructor(code: CapsuleErrorCode, message: string, retryAt?: number) {
    super(message)
    this.name = 'CapsuleError'
    this.code = code
    this.retryAt = retryAt
  }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function assertValidCondition(condition: UnlockCondition): void {
  if (condition === null || typeof condition !== 'object') {
    throw new CapsuleError('INVALID_INPUT', 'unlockCondition must be an object')
  }
  switch (condition.type) {
    case 'none':
      return
    case 'passphrase':
      if (typeof condition.hash !== 'string' || condition.hash.length === 0) {
        throw new CapsuleError('INVALID_INPUT', 'passphrase hash must be a non-empty string')
      }
      return
    case 'after':
      if (!isFiniteInteger(condition.notBefore)) {
        throw new CapsuleError('INVALID_INPUT', 'condition.notBefore must be an integer epoch ms')
      }
      return
    default:
      throw new CapsuleError('INVALID_INPUT', `unknown condition type: ${(condition as { type: string }).type}`)
  }
}

/**
 * 胶囊生命周期服务。
 *
 * 不变量：
 * 1. createdAt 永不变；version 单调递增；openedAt 一旦写入永不清空。
 * 2. now < deliverAt 时一律锁定；now === deliverAt 视为可解锁（边界确定）。
 * 3. 所有变更必须带 expectedVersion，版本不匹配立即拒绝。
 * 4. operationId 已应用过的操作按幂等处理，不会重复生效。
 */
export class CapsuleService {
  private readonly capsules = new Map<string, Capsule>()
  private readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  private require(id: string): Capsule {
    const capsule = this.capsules.get(id)
    if (!capsule) {
      throw new CapsuleError('NOT_FOUND', `capsule not found: ${id}`)
    }
    return capsule
  }

  private static alreadyApplied(capsule: Capsule, operationId?: string): boolean {
    return operationId !== undefined && capsule.appliedOperations.includes(operationId)
  }

  create(input: CreateCapsuleInput): Capsule {
    if (typeof input.title !== 'string' || input.title.trim() === '') {
      throw new CapsuleError('INVALID_INPUT', 'title must be a non-empty string')
    }
    if (typeof input.content !== 'string') {
      throw new CapsuleError('INVALID_INPUT', 'content must be a string')
    }
    if (!isFiniteInteger(input.deliverAt)) {
      throw new CapsuleError('INVALID_INPUT', 'deliverAt must be an integer epoch ms')
    }
    const condition: UnlockCondition = input.unlockCondition ?? { type: 'none' }
    assertValidCondition(condition)

    const id = input.id ?? randomUUID()
    const existing = this.capsules.get(id)
    if (existing) {
      if (CapsuleService.alreadyApplied(existing, input.operationId)) {
        return existing
      }
      throw new CapsuleError('VERSION_CONFLICT', `capsule id already exists: ${id}`)
    }

    const now = this.clock.now()
    const capsule: Capsule = {
      id,
      title: input.title,
      content: input.content,
      deliverAt: input.deliverAt,
      unlockCondition: condition,
      status: 'sealed',
      version: 1,
      createdAt: now,
      updatedAt: now,
      openedAt: null,
      appliedOperations: input.operationId ? [input.operationId] : [],
    }
    this.capsules.set(id, capsule)
    return { ...capsule, appliedOperations: [...capsule.appliedOperations] }
  }

  get(id: string): Capsule {
    const capsule = this.require(id)
    return { ...capsule, appliedOperations: [...capsule.appliedOperations] }
  }

  list(): Capsule[] {
    return [...this.capsules.values()].map((c) => ({
      ...c,
      appliedOperations: [...c.appliedOperations],
    }))
  }

  /**
   * 派生当前状态（不写状态，避免读操作造成隐式状态迁移）。
   * 恰好等于 deliverAt 即视为可解锁；'after' 条件同样包含等于边界。
   */
  getStatus(id: string, at: number = this.clock.now()): CapsuleStatus {
    const capsule = this.require(id)
    if (capsule.status === 'opened') {
      return 'opened'
    }
    if (at < capsule.deliverAt) {
      return 'sealed'
    }
    if (
      capsule.unlockCondition.type === 'after' &&
      at < capsule.unlockCondition.notBefore
    ) {
      return 'sealed'
    }
    return 'deliverable'
  }

  edit(id: string, patch: EditCapsuleInput): Capsule {
    const capsule = this.require(id)

    if (CapsuleService.alreadyApplied(capsule, patch.operationId)) {
      return this.get(id)
    }
    if (capsule.status === 'opened') {
      throw new CapsuleError('ALREADY_OPENED', 'opened capsule can no longer be edited')
    }
    if (patch.expectedVersion !== capsule.version) {
      throw new CapsuleError(
        'VERSION_CONFLICT',
        `expected version ${capsule.version}, got ${patch.expectedVersion}`,
      )
    }
    if (patch.title !== undefined) {
      if (typeof patch.title !== 'string' || patch.title.trim() === '') {
        throw new CapsuleError('INVALID_INPUT', 'title must be a non-empty string')
      }
      capsule.title = patch.title
    }
    if (patch.content !== undefined) {
      if (typeof patch.content !== 'string') {
        throw new CapsuleError('INVALID_INPUT', 'content must be a string')
      }
      capsule.content = patch.content
    }
    if (patch.deliverAt !== undefined) {
      if (!isFiniteInteger(patch.deliverAt)) {
        throw new CapsuleError('INVALID_INPUT', 'deliverAt must be an integer epoch ms')
      }
      capsule.deliverAt = patch.deliverAt
    }
    if (patch.unlockCondition !== undefined) {
      assertValidCondition(patch.unlockCondition)
      capsule.unlockCondition = patch.unlockCondition
    }

    capsule.version += 1
    capsule.updatedAt = this.clock.now()
    if (patch.operationId) {
      capsule.appliedOperations.push(patch.operationId)
    }
    return this.get(id)
  }

  unlock(id: string, input: UnlockInput = {}): Capsule {
    const capsule = this.require(id)

    // 已解锁：幂等返回，openedAt 保持首次解锁时刻不变（状态不回退）
    if (capsule.status === 'opened') {
      return this.get(id)
    }

    if (CapsuleService.alreadyApplied(capsule, input.operationId)) {
      return this.get(id)
    }

    const now = this.clock.now()
    if (now < capsule.deliverAt) {
      throw new CapsuleError(
        'LOCKED_BEFORE_DELIVERY',
        `capsule locked until ${capsule.deliverAt} (now ${now})`,
        capsule.deliverAt,
      )
    }
    const condition = capsule.unlockCondition
    if (condition.type === 'after' && now < condition.notBefore) {
      throw new CapsuleError(
        'CONDITION_NOT_MET',
        `open condition not met until ${condition.notBefore} (now ${now})`,
        condition.notBefore,
      )
    }
    if (condition.type === 'passphrase') {
      if (!input.passphrase || sha256(input.passphrase) !== condition.hash) {
        throw new CapsuleError('CONDITION_NOT_MET', 'passphrase does not match')
      }
    }

    capsule.status = 'opened'
    capsule.openedAt = now
    capsule.updatedAt = now
    capsule.version += 1
    if (input.operationId) {
      capsule.appliedOperations.push(input.operationId)
    }
    return this.get(id)
  }

  /** 导出内存快照（供持久化） */
  snapshot(): Capsule[] {
    return this.list()
  }

  /** 从持久化记录恢复（每个调用方负责先经 store 校验并报告损坏记录） */
  restore(capsules: Capsule[]): void {
    this.capsules.clear()
    for (const capsule of capsules) {
      this.capsules.set(capsule.id, {
        ...capsule,
        appliedOperations: [...capsule.appliedOperations],
      })
    }
  }
}
