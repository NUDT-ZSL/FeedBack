import type { ImportIssue, NormalizedRecord, RawRecord } from './types.ts';

export const UNKNOWN = '未知';

const MIN_YEAR = 1888;
const MAX_YEAR = 2099;

function isRecord(v: unknown): v is RawRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pick(raw: RawRecord, aliases: string[]): unknown {
  for (const key of aliases) {
    if (key in raw) {
      const v = raw[key];
      if (v !== undefined && v !== null && v !== '') return v;
    }
  }
  return undefined;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return collapseWhitespace(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

export function normalizeYear(v: unknown, issues: ImportIssue[]): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= MIN_YEAR && v <= MAX_YEAR) return v;
  const s = normalizeText(v);
  if (!s) return null;
  const m = s.match(/\d{4}/);
  if (m) {
    const y = parseInt(m[0], 10);
    if (y >= MIN_YEAR && y <= MAX_YEAR) {
      if (s !== m[0]) {
        issues.push({ level: 'info', code: 'year_normalized', field: 'year', message: `年份「${s}」归一为 ${y}` });
      }
      return y;
    }
  }
  issues.push({ level: 'warning', code: 'year_invalid', field: 'year', message: `年份「${s}」无法识别，归为${UNKNOWN}` });
  return null;
}

export function normalizeRating(v: unknown, issues: ImportIssue[]): number | null {
  if (v === undefined || v === null || v === '') return null;
  let n: number | null = null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    n = v;
  } else {
    const s = normalizeText(v);
    const m = s.match(/-?\d+(\.\d+)?/);
    if (m) n = parseFloat(m[0]);
  }
  if (n === null || Number.isNaN(n)) {
    issues.push({ level: 'warning', code: 'rating_invalid', field: 'rating', message: `评分「${normalizeText(v)}」无法识别，归为${UNKNOWN}` });
    return null;
  }
  if (n < 0 || n > 10) {
    issues.push({ level: 'warning', code: 'rating_out_of_range', field: 'rating', message: `评分 ${n} 超出 0-10 范围，归为${UNKNOWN}` });
    return null;
  }
  return Math.round(n * 10) / 10;
}

const WATCHED_TRUE = new Set(['true', '1', 'yes', 'y', 'watched', 'seen', '已看', '看过', '已观看', '是']);
const WATCHED_FALSE = new Set(['false', '0', 'no', 'n', 'unwatched', 'unseen', '未看', '未观看', '想看', '否']);

export function normalizeWatched(v: unknown, issues: ImportIssue[]): boolean | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = normalizeText(v).toLowerCase();
  if (WATCHED_TRUE.has(s)) return true;
  if (WATCHED_FALSE.has(s)) return false;
  issues.push({ level: 'warning', code: 'watched_invalid', field: 'watched', message: `观看状态「${normalizeText(v)}」无法识别，归为${UNKNOWN}` });
  return null;
}

export function normalizeDate(v: unknown, issues: ImportIssue[]): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = normalizeText(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const iso = `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (iso !== s) {
        issues.push({ level: 'info', code: 'date_normalized', field: 'watchDate', message: `观影日期「${s}」归一为 ${iso}` });
      }
      return iso;
    }
  }
  issues.push({ level: 'warning', code: 'date_invalid', field: 'watchDate', message: `观影日期「${s}」无法识别，归为${UNKNOWN}` });
  return null;
}

export function normalizeGenre(v: unknown, issues: ImportIssue[]): string[] {
  if (v === undefined || v === null || v === '') return [UNKNOWN];
  let parts: string[] = [];
  if (Array.isArray(v)) {
    parts = v.map((x) => normalizeText(x)).filter(Boolean);
  } else {
    parts = normalizeText(v)
      .split(/[,，;；/|、]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  if (out.length === 0) {
    issues.push({ level: 'warning', code: 'genre_invalid', field: 'genre', message: `类型无法识别，归为${UNKNOWN}` });
    return [UNKNOWN];
  }
  return out;
}

export function normalizeRecord(raw: unknown, row: number): NormalizedRecord {
  const issues: ImportIssue[] = [];
  const obj: RawRecord = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) {
    issues.push({ level: 'error', code: 'record_not_object', message: '该条目不是有效的记录对象' });
  }
  const title = normalizeText(pick(obj, ['title', 'Title', 'name', 'Name', '片名', '名称', '电影名', 'movie', 'film']));
  if (!title) {
    issues.push({ level: 'error', code: 'title_missing', field: 'title', message: '缺少片名，无法识别该条记录' });
  }
  const year = normalizeYear(pick(obj, ['year', 'Year', '年份', 'releaseYear', 'released', 'Released']), issues);
  const director = normalizeText(pick(obj, ['director', 'Director', '导演', 'directors']));
  const genre = normalizeGenre(pick(obj, ['genre', 'Genre', 'genres', 'Genres', '类型', 'tags']), issues);
  const rating = normalizeRating(pick(obj, ['rating', 'Rating', 'personalRating', 'score', 'Score', '评分', '我的评分', 'stars']), issues);
  const watchDate = normalizeDate(pick(obj, ['watchDate', 'watch_date', 'watchedAt', 'date', 'Date', '观影日期', '观看日期']), issues);
  const watched = normalizeWatched(pick(obj, ['watched', 'Watched', 'status', 'Status', '观看状态', '已看', 'seen']), issues);
  const externalIdRaw = normalizeText(pick(obj, ['id', 'imdbID', 'imdbId', 'imdb_id', 'imdb', 'tmdbId', 'tmdb_id', 'externalId', 'uid']));
  const externalId = externalIdRaw || null;
  const source = normalizeText(pick(obj, ['source', 'Source', '来源'])) || '外部片单';
  return { row, title, year, director, genre, rating, watchDate, watched, externalId, source, issues, raw: obj };
}

export function normalizeAll(records: unknown[]): NormalizedRecord[] {
  return records.map((r, i) => normalizeRecord(r, i + 1));
}
