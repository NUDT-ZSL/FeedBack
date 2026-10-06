import type {
  GalleryItem,
  MatchRecord,
  MatchStats,
  PersistedStateV1,
  Score,
  StoredGalleryItem,
} from '../types';

export const GALLERY_LIMIT = 20;
export const STORAGE_KEY = 'doucha.persistence.v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

export function getDefaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__doucha_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    // fall through to in-memory storage
  }
  return createMemoryStorage();
}

export function emptyPersistedState(): PersistedStateV1 {
  return { version: 1, gallery: [], records: [] };
}

export function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadPersistedState(storage: StorageLike): PersistedStateV1 {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyPersistedState();
    const parsed = JSON.parse(raw) as Partial<PersistedStateV1>;
    const gallery = Array.isArray(parsed.gallery) ? parsed.gallery : [];
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    return markConflicts({ version: 1, gallery, records });
  } catch {
    return emptyPersistedState();
  }
}

export function savePersistedState(storage: StorageLike, state: PersistedStateV1): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable: keep in-memory state only
  }
}

export function galleryKeyOf(round: number, patternKey: string): string {
  return `${round}::${patternKey}`;
}

export function recordKeyOf(round: number): string {
  return `round::${round}`;
}

function scoresEqual(a: Score, b: Score): boolean {
  return a.color === b.color && a.duration === b.duration && a.adhesion === b.adhesion && a.total === b.total;
}

function galleryContentEqual(a: StoredGalleryItem, b: StoredGalleryItem): boolean {
  return (
    a.thumbnail === b.thumbnail && a.pattern.id === b.pattern.id && scoresEqual(a.roundScore, b.roundScore)
  );
}

function recordContentEqual(a: MatchRecord, b: MatchRecord): boolean {
  return scoresEqual(a.userScore, b.userScore) && scoresEqual(a.aiScore, b.aiScore);
}

function deriveWinner(userScore: Score, aiScore: Score): MatchRecord['winner'] {
  if (userScore.total > aiScore.total) return 'user';
  if (userScore.total < aiScore.total) return 'ai';
  return 'draw';
}

/**
 * Scans the restored/updated collections. When several entries share the same
 * round key, all of them are kept and flagged with the same `conflictKey` so
 * the user can adjudicate them in the UI.
 */
export function markConflicts(state: PersistedStateV1): PersistedStateV1 {
  const galleryGroups = new Map<string, StoredGalleryItem[]>();
  state.gallery.forEach((item) => {
    const key = galleryKeyOf(item.round, item.patternKey);
    const group = galleryGroups.get(key);
    if (group) group.push(item);
    else galleryGroups.set(key, [item]);
  });
  state.gallery.forEach((item) => {
    const key = galleryKeyOf(item.round, item.patternKey);
    item.conflictKey = (galleryGroups.get(key) as StoredGalleryItem[]).length > 1 ? key : null;
  });

  const recordGroups = new Map<string, MatchRecord[]>();
  state.records.forEach((record) => {
    const key = recordKeyOf(record.round);
    const group = recordGroups.get(key);
    if (group) group.push(record);
    else recordGroups.set(key, [record]);
  });
  state.records.forEach((record) => {
    const key = recordKeyOf(record.round);
    record.conflictKey = (recordGroups.get(key) as MatchRecord[]).length > 1 ? key : null;
  });

  state.records.sort((a, b) => a.round - b.round || a.recordedAt - b.recordedAt);
  return state;
}

export interface GalleryUpsertInput {
  round: number;
  patternKey: string;
  item: Omit<GalleryItem, 'id' | 'createdAt'>;
  updatedAt?: number;
  id?: string;
}

/**
 * Idempotent, out-of-order tolerant upsert keyed by (round, pattern).
 * - An older submission than the newest stored one is ignored.
 * - An identical submission is a no-op.
 * - A newer submission replaces every entry of the key (latest wins), which
 *   also clears any pre-existing conflict group for that key.
 */
export function upsertGalleryItem(
  state: PersistedStateV1,
  input: GalleryUpsertInput,
): PersistedStateV1 {
  const updatedAt = input.updatedAt ?? Date.now();
  const key = galleryKeyOf(input.round, input.patternKey);
  const group = state.gallery.filter((entry) => galleryKeyOf(entry.round, entry.patternKey) === key);

  if (group.length > 0) {
    const newest = group.reduce((acc, entry) => (entry.updatedAt > acc.updatedAt ? entry : acc));
    if (updatedAt < newest.updatedAt) return state;

    const candidate: StoredGalleryItem = {
      ...input.item,
      id: input.id ?? makeId(),
      createdAt: newest.createdAt,
      round: input.round,
      patternKey: input.patternKey,
      updatedAt,
      conflictKey: null,
    };
    if (group.length === 1 && galleryContentEqual(group[0], candidate)) return state;

    const gallery = state.gallery
      .filter((entry) => galleryKeyOf(entry.round, entry.patternKey) !== key)
      .concat(candidate);
    return markConflicts({ ...state, gallery: sortAndTrimGallery(gallery) });
  }

  const candidate: StoredGalleryItem = {
    ...input.item,
    id: input.id ?? makeId(),
    createdAt: updatedAt,
    round: input.round,
    patternKey: input.patternKey,
    updatedAt,
    conflictKey: null,
  };
  return markConflicts({ ...state, gallery: sortAndTrimGallery([candidate, ...state.gallery]) });
}

function sortAndTrimGallery(gallery: StoredGalleryItem[]): StoredGalleryItem[] {
  return gallery
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, GALLERY_LIMIT);
}

export interface RecordInput {
  round: number;
  userScore: Score;
  aiScore: Score;
  recordedAt?: number;
  id?: string;
}

/**
 * Idempotent, out-of-order tolerant upsert keyed by round.
 * Older submissions are ignored, identical ones are no-ops, newer ones win.
 */
export function upsertMatchRecord(state: PersistedStateV1, input: RecordInput): PersistedStateV1 {
  const recordedAt = input.recordedAt ?? Date.now();
  const key = recordKeyOf(input.round);
  const group = state.records.filter((entry) => recordKeyOf(entry.round) === key);

  const candidate: MatchRecord = {
    id: input.id ?? makeId(),
    round: input.round,
    userScore: { ...input.userScore },
    aiScore: { ...input.aiScore },
    winner: deriveWinner(input.userScore, input.aiScore),
    recordedAt,
    conflictKey: null,
  };

  if (group.length > 0) {
    const newest = group.reduce((acc, entry) => (entry.recordedAt > acc.recordedAt ? entry : acc));
    if (recordedAt < newest.recordedAt) return state;
    if (group.length === 1 && recordContentEqual(group[0], candidate)) return state;

    const records = state.records.filter((entry) => recordKeyOf(entry.round) !== key).concat(candidate);
    return markConflicts({ ...state, records });
  }

  return markConflicts({ ...state, records: [...state.records, candidate] });
}

/** Keep one candidate of a gallery conflict group; other history stays untouched. */
export function resolveGalleryConflict(
  state: PersistedStateV1,
  conflictKey: string,
  keepId: string,
): PersistedStateV1 {
  const group = state.gallery.filter(
    (item) => galleryKeyOf(item.round, item.patternKey) === conflictKey,
  );
  if (group.length < 2 || !group.some((item) => item.id === keepId)) return state;
  const gallery = state.gallery
    .filter((item) => galleryKeyOf(item.round, item.patternKey) !== conflictKey || item.id === keepId)
    .map((item) => (item.id === keepId ? { ...item, conflictKey: null } : item));
  return markConflicts({ ...state, gallery });
}

/** Keep one candidate of a round-record conflict group; other rounds stay untouched. */
export function resolveRecordConflict(
  state: PersistedStateV1,
  conflictKey: string,
  keepId: string,
): PersistedStateV1 {
  const group = state.records.filter((record) => recordKeyOf(record.round) === conflictKey);
  if (group.length < 2 || !group.some((record) => record.id === keepId)) return state;
  const records = state.records
    .filter((record) => recordKeyOf(record.round) !== conflictKey || record.id === keepId)
    .map((record) => (record.id === keepId ? { ...record, conflictKey: null } : record));
  return markConflicts({ ...state, records });
}

export function computeMatchStats(records: MatchRecord[]): MatchStats {
  const stats: MatchStats = { wins: 0, losses: 0, draws: 0, total: 0 };
  records
    .filter((record) => record.conflictKey === null)
    .forEach((record) => {
      stats.total += 1;
      if (record.winner === 'user') stats.wins += 1;
      else if (record.winner === 'ai') stats.losses += 1;
      else stats.draws += 1;
    });
  return stats;
}

/** Cumulative win/loss/draw totals up to and including each settled round. */
export function cumulativeStats(records: MatchRecord[]): MatchStats[] {
  const sorted = records
    .filter((record) => record.conflictKey === null)
    .slice()
    .sort((a, b) => a.round - b.round);
  const running: MatchStats = { wins: 0, losses: 0, draws: 0, total: 0 };
  return sorted.map((record) => {
    running.total += 1;
    if (record.winner === 'user') running.wins += 1;
    else if (record.winner === 'ai') running.losses += 1;
    else running.draws += 1;
    return { ...running };
  });
}

export function nextRoundFromRecords(records: MatchRecord[]): number {
  const settled = records.filter((record) => record.conflictKey === null);
  if (settled.length === 0) return 1;
  return Math.max(...settled.map((record) => record.round)) + 1;
}
