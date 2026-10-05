import type { Batch, FlourType } from './types';
import { FLOUR_TYPES } from './types';

/**
 * 批次记录的离线持久化（localStorage，不依赖任何网络/后端）。
 * 读取时做结构校验，脏数据直接丢弃，保证刷新后批次列表一致。
 */

const STORAGE_KEY = 'ancient-mill:batches:v1';

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isValidBatch = (v: unknown): v is Batch => {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    isFiniteNumber(b.seq) &&
    FLOUR_TYPES.includes(b.type as FlourType) &&
    isFiniteNumber(b.weight) &&
    isFiniteNumber(b.packedAt) &&
    Array.isArray(b.evidence)
  );
};

export const loadBatches = (): Batch[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidBatch);
  } catch {
    return [];
  }
};

export const saveBatches = (batches: Batch[]): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
  } catch {
    // 存储满或被禁用时静默失败，不影响磨坊运转
  }
};
