import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Capsule, PersistedStatus, UnlockCondition } from './types.ts'

export type StoreErrorCode = 'FILE_MISSING' | 'FILE_CORRUPT' | 'RECORD_DEFECTS'

export class StoreError extends Error {
  readonly code: StoreErrorCode

  constructor(code: StoreErrorCode, message: string) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

export interface RecordDefect {
  index: number
  id: string | null
  reasons: string[]
}

export interface LoadResult {
  capsules: Capsule[]
  defects: RecordDefect[]
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/** 校验单条持久化记录，返回所有问题（不静默丢弃任何字段级错误） */
export function validateCapsuleRecord(record: unknown): string[] {
  const reasons: string[] = []
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return ['record is not an object']
  }
  const r = record as Record<string, unknown>

  if (!isString(r.id) || r.id.length === 0) reasons.push('id must be a non-empty string')
  if (!isString(r.title) || r.title.length === 0) reasons.push('title must be a non-empty string')
  if (!isString(r.content)) reasons.push('content must be a string')
  if (!isInteger(r.deliverAt)) reasons.push('deliverAt must be an integer epoch ms')
  if (!isInteger(r.createdAt)) reasons.push('createdAt must be an integer epoch ms')
  if (!isInteger(r.updatedAt)) reasons.push('updatedAt must be an integer epoch ms')
  if (!isInteger(r.version) || r.version < 1) reasons.push('version must be an integer >= 1')

  const statuses: PersistedStatus[] = ['sealed', 'opened']
  if (!statuses.includes(r.status as PersistedStatus)) {
    reasons.push('status must be sealed or opened')
  }
  if (r.openedAt !== null && !isInteger(r.openedAt)) {
    reasons.push('openedAt must be null or an integer epoch ms')
  }
  if (r.status === 'opened' && !isInteger(r.openedAt)) {
    reasons.push('opened capsule must carry an integer openedAt')
  }
  if (isInteger(r.updatedAt) && isInteger(r.createdAt) && r.updatedAt < r.createdAt) {
    reasons.push('updatedAt must not precede createdAt')
  }
  if (
    isInteger(r.openedAt) &&
    isInteger(r.createdAt) &&
    (r.openedAt as number) < r.createdAt
  ) {
    reasons.push('openedAt must not precede createdAt')
  }
  if (!Array.isArray(r.appliedOperations) || r.appliedOperations.some((o) => !isString(o))) {
    reasons.push('appliedOperations must be an array of strings')
  }
  reasons.push(...validateCondition(r.unlockCondition))
  return reasons
}

function validateCondition(condition: unknown): string[] {
  if (condition === null || typeof condition !== 'object') {
    return ['unlockCondition must be an object']
  }
  const c = condition as UnlockCondition
  switch (c.type) {
    case 'none':
      return []
    case 'passphrase':
      return isString((c as { hash?: unknown }).hash) && c.hash.length > 0
        ? []
        : ['unlockCondition.hash must be a non-empty string']
    case 'after':
      return isInteger((c as { notBefore?: unknown }).notBefore)
        ? []
        : ['unlockCondition.notBefore must be an integer epoch ms']
    default:
      return [`unknown unlockCondition type: ${(c as { type?: unknown }).type}`]
  }
}

/**
 * 基于本地 JSON 文件的持久化存储（离线可用，无外部服务依赖）。
 * 写入采用 tmp + rename 原子替换，避免半写文件。
 */
export class JsonCapsuleStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async save(capsules: Capsule[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp-${process.pid}`
    const payload = JSON.stringify({ version: 1, capsules }, null, 2)
    await fs.writeFile(tmp, payload, 'utf8')
    await fs.rename(tmp, this.filePath)
  }

  /**
   * 加载并逐条校验。
   * - 文件不存在：抛 FILE_MISSING（缺失必须被显式识别）
   * - JSON 无法解析或顶层结构错误：抛 FILE_CORRUPT
   * - 单条记录损坏：不跳过、不吞掉，体现在返回值 defects 中
   */
  async load(): Promise<LoadResult> {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StoreError('FILE_MISSING', `persistence file not found: ${this.filePath}`)
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new StoreError('FILE_CORRUPT', `persistence file is not valid JSON: ${this.filePath}`)
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { capsules?: unknown }).capsules)
    ) {
      throw new StoreError('FILE_CORRUPT', 'persistence file has unexpected top-level shape')
    }

    const records = (parsed as { capsules: unknown[] }).capsules
    const capsules: Capsule[] = []
    const defects: RecordDefect[] = []
    const seenIds = new Map<string, number>()

    records.forEach((record, index) => {
      const reasons = validateCapsuleRecord(record)
      const id =
        record !== null && typeof record === 'object' && isString((record as { id?: unknown }).id)
          ? ((record as { id: string }).id)
          : null
      if (id !== null) {
        const firstIndex = seenIds.get(id)
        if (firstIndex !== undefined) {
          reasons.push(`duplicate id "${id}" first seen at index ${firstIndex}`)
        } else {
          seenIds.set(id, index)
        }
      }
      if (reasons.length > 0) {
        defects.push({ index, id, reasons })
        return
      }
      capsules.push(record as Capsule)
    })

    return { capsules, defects }
  }

  /** 便捷加载：存在损坏记录时直接抛错，错误信息包含每条缺陷明细 */
  async loadStrict(): Promise<Capsule[]> {
    const result = await this.load()
    if (result.defects.length > 0) {
      const detail = result.defects
        .map((d) => `index=${d.index} id=${d.id ?? '<unknown>'}: ${d.reasons.join('; ')}`)
        .join(' | ')
      throw new StoreError('RECORD_DEFECTS', `corrupted capsule records detected: ${detail}`)
    }
    return result.capsules
  }
}
