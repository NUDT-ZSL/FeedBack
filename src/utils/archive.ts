import type { DivinationRecord } from '@/types';

const STORAGE_KEY = 'liuyao-archive-v1';

/** 同毫秒内连续起卦的递增序号，保证 ID 不重复 */
let idCounter = 0;
let lastIdTimestamp = 0;

/** 生成全局唯一记录 ID：时间戳 + 同毫秒序号 + 随机后缀 */
export function createRecordId(createdAt: number): string {
  if (createdAt !== lastIdTimestamp) {
    lastIdTimestamp = createdAt;
    idCounter = 0;
  }
  const counter = idCounter++;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${createdAt.toString(36)}-${String(counter).padStart(3, '0')}-${rand}`;
}

/** 读取本地归档，按起卦时刻倒序（时间戳相同则保持后存者在前） */
export function loadRecords(): DivinationRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return sortRecords(parsed as DivinationRecord[]);
  } catch {
    return [];
  }
}

/** 全量写回本地归档 */
export function saveRecords(records: DivinationRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/** 倒序排序：时间戳降序，时间戳相同则 id 生成顺序（id 前缀带递增序号）降序 */
export function sortRecords(records: DivinationRecord[]): DivinationRecord[] {
  return [...records].sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}
