import type {
  GalleryItem,
  MatchHistory,
  ResolvedRound,
  RoundConflict,
  RoundRecord,
  Score,
} from '../types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const GALLERY_STORAGE_KEY = 'doucha.gallery.v1';
export const ROUNDS_STORAGE_KEY = 'doucha.rounds.v1';
export const GALLERY_LIMIT = 20;

export class MemoryStorage implements StorageLike {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const memoryFallback = new MemoryStorage();

export function getDefaultStorage(): StorageLike {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      const probeKey = '__doucha_storage_probe__';
      (globalThis as unknown as { localStorage: StorageLike }).localStorage.setItem(probeKey, '1');
      (globalThis as unknown as { localStorage: StorageLike }).localStorage.removeItem(probeKey);
      return (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    }
  } catch {
    // localStorage unavailable (privacy mode, SSR, test env): fall back to memory
  }
  return memoryFallback;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return null;
  }
}

function isScore(value: unknown): value is Score {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return ['color', 'duration', 'adhesion', 'total'].every(
    key => typeof s[key] === 'number',
  );
}

/* ---------------- Gallery (分茶图鉴) ---------------- */

export function galleryKey(item: Pick<GalleryItem, 'round' | 'pattern'>): string {
  return `${item.round}:${item.pattern.type}`;
}

/**
 * 以 (回合, 图案类型) 为幂等键：同一回合的同一图案只保留一条，
 * 重复提交时用最新结果覆盖旧记录，而不是追加。
 */
export function upsertGalleryItem(
  gallery: GalleryItem[],
  item: GalleryItem,
  limit: number = GALLERY_LIMIT,
): GalleryItem[] {
  const key = galleryKey(item);
  const rest = gallery.filter(existing => galleryKey(existing) !== key);
  return [item, ...rest].slice(0, limit);
}

function isGalleryItem(value: unknown): value is GalleryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.thumbnail === 'string' &&
    typeof item.createdAt === 'number' &&
    isScore(item.roundScore) &&
    !!item.pattern &&
    typeof (item.pattern as Record<string, unknown>).type === 'string'
  );
}

export function loadGallery(storage: StorageLike = getDefaultStorage()): GalleryItem[] {
  const parsed = safeParse<unknown[]>(storage.getItem(GALLERY_STORAGE_KEY));
  if (!Array.isArray(parsed)) return [];
  const items = parsed
    .filter(isGalleryItem)
    .map(item => ({ ...item, round: typeof item.round === 'number' ? item.round : 0 }));
  // 防御性去重：缓存里若已存在同回合同图案，保留最新一条（数组靠前的为最新）
  const seen = new Set<string>();
  const deduped: GalleryItem[] = [];
  for (const item of items) {
    const key = galleryKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function saveGallery(
  gallery: GalleryItem[],
  storage: StorageLike = getDefaultStorage(),
): void {
  try {
    storage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(gallery));
  } catch {
    // 存储满或不可用（隐私模式等）：静默失败，本轮内存数据仍可用
  }
}

/* ---------------- Match records (对局记录) ---------------- */

export function scoresEqual(a: Score, b: Score): boolean {
  return (
    a.color === b.color &&
    a.duration === b.duration &&
    a.adhesion === b.adhesion &&
    a.total === b.total
  );
}

export function roundRecordsEqual(a: RoundRecord, b: RoundRecord): boolean {
  return (
    a.round === b.round &&
    scoresEqual(a.userScore, b.userScore) &&
    scoresEqual(a.aiScore, b.aiScore)
  );
}

function isRoundRecord(value: unknown): value is RoundRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.round === 'number' &&
    typeof record.updatedAt === 'number' &&
    isScore(record.userScore) &&
    isScore(record.aiScore)
  );
}

export function loadRoundRecords(storage: StorageLike = getDefaultStorage()): RoundRecord[] {
  const parsed = safeParse<unknown[]>(storage.getItem(ROUNDS_STORAGE_KEY));
  if (!Array.isArray(parsed)) return [];
  // 完全相同的重复记录（同一回合、同样分数）在恢复时直接合并，不视为冲突
  const unique: RoundRecord[] = [];
  for (const value of parsed) {
    if (!isRoundRecord(value)) continue;
    if (!unique.some(existing => roundRecordsEqual(existing, value))) {
      unique.push(value);
    }
  }
  return unique;
}

export function saveRoundRecords(
  records: RoundRecord[],
  storage: StorageLike = getDefaultStorage(),
): void {
  try {
    storage.setItem(ROUNDS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // ignore quota / unavailable storage errors
  }
}

/**
 * 追加一条回合记录，容忍重复提交：
 * - 同一回合且双方分数完全相同 -> 幂等忽略
 * - 同一回合但分数不同 -> 保留两条，交由恢复流程标记冲突并由用户裁决
 * 乱序到达不受限制，读取时按回合号排序。
 */
export function appendRoundRecord(
  records: RoundRecord[],
  record: RoundRecord,
): RoundRecord[] {
  const duplicated = records.some(existing => roundRecordsEqual(existing, record));
  if (duplicated) return records;
  return [...records, record];
}

/**
 * 恢复对局历史：按回合分组，同一回合存在不同记录时双方都保留并标记冲突。
 */
export function buildMatchHistory(records: RoundRecord[]): MatchHistory {
  const groups = new Map<number, RoundRecord[]>();
  for (const record of records) {
    const group = groups.get(record.round) ?? [];
    group.push(record);
    groups.set(record.round, group);
  }

  const rounds: ResolvedRound[] = [];
  const conflicts: RoundConflict[] = [];

  for (const round of [...groups.keys()].sort((a, b) => a - b)) {
    const candidates = (groups.get(round) ?? [])
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (candidates.length > 1) {
      conflicts.push({ round, candidates });
      continue;
    }
    rounds.push(withWinner(candidates[0]));
  }

  const totals = rounds.reduce(
    (acc, entry) => {
      if (entry.winner === 'user') acc.wins += 1;
      else if (entry.winner === 'ai') acc.losses += 1;
      else acc.draws += 1;
      return acc;
    },
    { wins: 0, losses: 0, draws: 0 },
  );

  return { rounds, conflicts, totals };
}

function withWinner(record: RoundRecord): ResolvedRound {
  let winner: ResolvedRound['winner'] = 'draw';
  if (record.userScore.total > record.aiScore.total) winner = 'user';
  else if (record.userScore.total < record.aiScore.total) winner = 'ai';
  return { ...record, winner };
}

/**
 * 用户裁决某回合的冲突：只保留选中的那条记录，删除同回合的其余候选，
 * 其他回合的历史记录完全不受影响。
 */
export function resolveRoundConflict(
  records: RoundRecord[],
  round: number,
  keepId: string,
): RoundRecord[] {
  return records.filter(
    record => record.round !== round || record.id === keepId,
  );
}
