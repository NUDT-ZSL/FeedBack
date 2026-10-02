import { HISTORY_STORAGE_KEY } from './constants.ts';
import type {
  AnyHistoryRecord,
  BoundaryEvent,
  FinalConclusion,
  HistoryRecordV2,
  Intermediates,
  LegacyHistoryRecord,
  QualityRating,
  Recipe,
} from './types.ts';

const RATINGS: QualityRating[] = ['甲', '乙', '丙', '次品'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toRating(value: unknown, score: number | null): QualityRating {
  if (typeof value === 'string' && (RATINGS as string[]).includes(value)) {
    return value as QualityRating;
  }
  if (score === null) return '次品';
  if (score >= 90) return '甲';
  if (score >= 75) return '乙';
  if (score >= 60) return '丙';
  return '次品';
}

export function migrateLegacyRecord(raw: LegacyHistoryRecord): HistoryRecordV2 {
  const score = typeof raw.score === 'number' ? raw.score : null;
  const rating = toRating(raw.level ?? raw.rating, score);
  const recipe: Recipe = {
    bark: raw.recipe?.bark ?? 0,
    bamboo: raw.recipe?.bamboo ?? 0,
    water: raw.recipe?.water ?? 0,
  };
  const conclusion: FinalConclusion = {
    rating,
    score,
    valid: true,
    reasons: ['由旧版记录迁移，仅保留评分与评级'],
  };
  const intermediates: Intermediates = {
    concentration: null,
    uniformity: null,
    pressForce: null,
    pressEffective: false,
    dryness: 0,
    inspectScore: score,
  };
  return {
    version: 2,
    id: raw.id ?? `legacy-${raw.time ?? raw.createdAt ?? 0}`,
    createdAt: raw.createdAt ?? raw.time ?? 0,
    recipe,
    operations: [],
    conclusion,
    intermediates,
    events: [],
  };
}

export function parseHistoryRecord(raw: unknown): HistoryRecordV2 | null {
  if (!isRecord(raw)) return null;
  if (raw.version === 2) {
    const record = raw as unknown as HistoryRecordV2;
    if (!record.conclusion || !record.intermediates || !record.recipe) return null;
    return record;
  }
  return migrateLegacyRecord(raw as LegacyHistoryRecord);
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadHistory(
  storage: StorageLike | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
  key: string = HISTORY_STORAGE_KEY,
): HistoryRecordV2[] {
  if (!storage) return [];
  const text = storage.getItem(key);
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const records: HistoryRecordV2[] = [];
    for (const item of parsed as AnyHistoryRecord[]) {
      const record = parseHistoryRecord(item);
      if (record) records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

export function saveHistory(
  records: HistoryRecordV2[],
  storage: StorageLike | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
  key: string = HISTORY_STORAGE_KEY,
): void {
  if (!storage) return;
  storage.setItem(key, JSON.stringify(records));
}

export function toHistoryRecord(
  id: string,
  createdAt: number,
  state: {
    recipe: Recipe;
    intermediates: Intermediates;
    events: BoundaryEvent[];
    conclusion: FinalConclusion | null;
  },
  operations: HistoryRecordV2['operations'],
): HistoryRecordV2 {
  return {
    version: 2,
    id,
    createdAt,
    recipe: { ...state.recipe },
    operations: [...operations],
    conclusion: state.conclusion ?? {
      rating: '次品',
      score: null,
      valid: false,
      reasons: ['流程未完成，未产生检验结论'],
    },
    intermediates: { ...state.intermediates },
    events: [...state.events],
  };
}
