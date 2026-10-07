/**
 * 胶囊本地持久化：JSON 文件存储。
 * - 写入采用 临时文件 + 原子重命名，避免半截文件；
 * - 加载时逐条校验记录：损坏的记录被明确列入 corrupted（含位置与原因），
 *   绝不静默跳过；文件缺失或整体非法时返回明确的错误结果。
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  isValidStatus,
  type Capsule,
  type UnlockCondition,
} from './capsule.ts';

export const STORE_SCHEMA_VERSION = 1;

export interface CorruptedRecord {
  index: number;
  id: string | null;
  reason: string;
}

export type StoreErrorCode = 'FILE_MISSING' | 'INVALID_JSON' | 'INVALID_SHAPE';

export type LoadResult =
  | { ok: true; capsules: Capsule[]; corrupted: CorruptedRecord[] }
  | { ok: false; error: { code: StoreErrorCode; message: string } };

interface StoreFile {
  schemaVersion: number;
  capsules: Capsule[];
}

/** 原子写入：先写临时文件再重命名，保证任何时刻文件要么完整要么不存在。 */
export function saveCapsules(filePath: string, capsules: Capsule[]): void {
  const payload: StoreFile = { schemaVersion: STORE_SCHEMA_VERSION, capsules };
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isValidCondition(raw: unknown): raw is UnlockCondition {
  if (typeof raw !== 'object' || raw === null) return false;
  const condition = raw as Record<string, unknown>;
  if (condition.type === 'none') return true;
  if (condition.type === 'after') return isFiniteNumber(condition.at);
  if (condition.type === 'passphrase') {
    return typeof condition.hash === 'string' && condition.hash.length > 0;
  }
  return false;
}

/** 校验单条记录，返回 null 表示合法，否则返回损坏原因。 */
export function validateCapsuleRecord(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return '记录不是对象';
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return '缺少合法的 id 字段';
  }
  if (typeof record.title !== 'string') return 'title 字段缺失或类型错误';
  if (typeof record.content !== 'string') return 'content 字段缺失或类型错误';
  if (!isFiniteNumber(record.deliverAt)) return 'deliverAt 不是有限数字';
  if (!isValidStatus(record.status)) {
    return `status 非法：${String(record.status)}`;
  }
  if (
    !Number.isInteger(record.version) ||
    (record.version as number) < 1
  ) {
    return 'version 不是 >= 1 的整数';
  }
  if (!isFiniteNumber(record.createdAt)) return 'createdAt 不是有限数字';
  if (!isFiniteNumber(record.updatedAt)) return 'updatedAt 不是有限数字';
  if ((record.updatedAt as number) < (record.createdAt as number)) {
    return 'updatedAt 早于 createdAt（时间戳回退）';
  }
  if (!isNullableNumber(record.deliveredAt)) return 'deliveredAt 非法';
  if (!isNullableNumber(record.unlockedAt)) return 'unlockedAt 非法';
  if (!isValidCondition(record.unlockCondition)) {
    return 'unlockCondition 结构非法';
  }
  const status = record.status;
  if (status === 'sealed') {
    if (record.deliveredAt !== null || record.unlockedAt !== null) {
      return 'sealed 状态却带有 deliveredAt/unlockedAt（状态与时间戳矛盾）';
    }
  }
  if (status === 'delivered') {
    if (!isFiniteNumber(record.deliveredAt)) {
      return 'delivered 状态缺少 deliveredAt';
    }
    if (record.unlockedAt !== null) {
      return 'delivered 状态却带有 unlockedAt（状态与时间戳矛盾）';
    }
    if ((record.deliveredAt as number) < (record.deliverAt as number)) {
      return 'deliveredAt 早于 deliverAt（投递时间矛盾）';
    }
  }
  if (status === 'unlocked') {
    if (
      !isFiniteNumber(record.deliveredAt) ||
      !isFiniteNumber(record.unlockedAt)
    ) {
      return 'unlocked 状态缺少 deliveredAt/unlockedAt';
    }
    if ((record.unlockedAt as number) < (record.deliveredAt as number)) {
      return 'unlockedAt 早于 deliveredAt（时间戳回退）';
    }
  }
  return null;
}

/**
 * 加载胶囊文件。
 * - 文件缺失 / JSON 无法解析 / 顶层结构非法：返回 ok:false 的明确错误；
 * - 单条记录损坏：该记录进入 corrupted（含序号、id、原因），
 *   合法记录照常返回，损坏记录绝不静默丢弃。
 */
export function loadCapsules(filePath: string): LoadResult {
  if (!existsSync(filePath)) {
    return {
      ok: false,
      error: { code: 'FILE_MISSING', message: `文件不存在：${filePath}` },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'INVALID_JSON',
        message: `JSON 解析失败：${(error as Error).message}`,
      },
    };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as Record<string, unknown>).schemaVersion !==
      STORE_SCHEMA_VERSION ||
    !Array.isArray((parsed as Record<string, unknown>).capsules)
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_SHAPE',
        message: '文件顶层结构非法（缺少 schemaVersion 或 capsules 数组）',
      },
    };
  }
  const rawList = (parsed as StoreFile).capsules as unknown[];
  const capsules: Capsule[] = [];
  const corrupted: CorruptedRecord[] = [];
  rawList.forEach((raw, index) => {
    const reason = validateCapsuleRecord(raw);
    if (reason === null) {
      capsules.push(raw as Capsule);
    } else {
      const id =
        typeof (raw as Record<string, unknown>)?.id === 'string'
          ? ((raw as Record<string, unknown>).id as string)
          : null;
      corrupted.push({ index, id, reason });
    }
  });
  return { ok: true, capsules, corrupted };
}
