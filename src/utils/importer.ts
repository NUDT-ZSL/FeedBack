import type {
  Movie,
  RawImportRecord,
  NormalizedImport,
  FieldIssue,
  ImportItemResult,
  ImportReport,
} from '../types';

export const UNKNOWN_GENRE = '未知';
export const UNKNOWN_YEAR = 0;

const MIN_YEAR = 1888;
const MAX_YEAR_OFFSET = 5;

const FIELD_ALIASES: Record<string, string[]> = {
  id: ['id', 'imdbid', 'imdb_id', 'imdb', '标识'],
  title: ['title', 'name', 'movie', 'film', '标题', '片名', '名称'],
  year: ['year', 'released', 'releaseyear', 'release_year', '年份', '上映年份'],
  rating: ['rating', 'personalrating', 'personal_rating', 'score', 'myrating', '评分', '个人评分'],
  watched: ['watched', 'seen', 'status', 'watchstatus', 'watch_status', '观看状态', '状态'],
  genre: ['genre', 'genres', 'type', 'category', '类型'],
  director: ['director', 'directors', '导演'],
  plot: ['plot', 'description', 'summary', '简介', '剧情'],
  poster: ['poster', 'image', 'cover', '海报'],
  watchdate: ['watchdate', 'watch_date', 'datewatched', 'date_watched', 'date', '观影日期', '观看日期'],
  addedat: ['addedat', 'added_at', 'createdat', 'created_at', '添加时间'],
};

const WATCHED_TRUE = new Set(['true', '1', 'yes', 'y', 'watched', 'seen', '已看', '已观看', '看过']);
const WATCHED_FALSE = new Set(['false', '0', 'no', 'n', 'unwatched', 'unseen', 'not watched', '未看', '未观看', '没看']);

function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

export function hashImportText(text: string): string {
  return hashString(text);
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickField(raw: RawImportRecord, canonical: string): unknown {
  const aliases = FIELD_ALIASES[canonical] ?? [canonical];
  const lowerMap = new Map<string, unknown>();
  for (const key of Object.keys(raw)) {
    lowerMap.set(key.toLowerCase().replace(/[\s-]/g, '_'), raw[key]);
  }
  for (const alias of aliases) {
    if (lowerMap.has(alias)) return lowerMap.get(alias);
  }
  return undefined;
}

function normalizeYear(value: unknown, issues: FieldIssue[]): number {
  if (value === undefined || value === null || String(value).trim() === '') return UNKNOWN_YEAR;
  const match = String(value).match(/\d{4}/);
  if (match) {
    const year = parseInt(match[0], 10);
    const maxYear = new Date().getFullYear() + MAX_YEAR_OFFSET;
    if (year >= MIN_YEAR && year <= maxYear) return year;
  }
  issues.push({ field: 'year', raw: value, note: '年份非法，归为未知' });
  return UNKNOWN_YEAR;
}

function normalizeRating(value: unknown, issues: FieldIssue[]): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const num = Number(String(value).trim());
  if (Number.isFinite(num) && num >= 0 && num <= 10) return Math.round(num * 10) / 10;
  issues.push({ field: 'rating', raw: value, note: '评分非法（需 0-10），归为未知' });
  return null;
}

function normalizeWatched(value: unknown, issues: FieldIssue[]): boolean {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  if (typeof value === 'boolean') return value;
  const key = String(value).trim().toLowerCase();
  if (WATCHED_TRUE.has(key)) return true;
  if (WATCHED_FALSE.has(key)) return false;
  issues.push({ field: 'watched', raw: value, note: '观看状态无法识别，归为未看' });
  return false;
}

function normalizeWatchDate(value: unknown, issues: FieldIssue[]): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }
  issues.push({ field: 'watchDate', raw: value, note: '观影日期非法，归为未知' });
  return null;
}

function normalizeText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeAddedAt(value: unknown): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Date.parse(String(value).trim());
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function normalizeRecord(raw: RawImportRecord, index: number): NormalizedImport | null {
  const title = normalizeText(pickField(raw, 'title'));
  if (!title) return null;
  const issues: FieldIssue[] = [];
  const idRaw = normalizeText(pickField(raw, 'id'));
  const genre = normalizeText(pickField(raw, 'genre')) || UNKNOWN_GENRE;
  return {
    index,
    id: idRaw || null,
    title,
    year: normalizeYear(pickField(raw, 'year'), issues),
    genre,
    director: normalizeText(pickField(raw, 'director')),
    plot: normalizeText(pickField(raw, 'plot')),
    poster: normalizeText(pickField(raw, 'poster')),
    personalRating: normalizeRating(pickField(raw, 'rating'), issues),
    watchDate: normalizeWatchDate(pickField(raw, 'watchdate'), issues),
    watched: normalizeWatched(pickField(raw, 'watched'), issues),
    addedAt: normalizeAddedAt(pickField(raw, 'addedat')),
    issues,
  };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function parseCsv(text: string): RawImportRecord[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const record: RawImportRecord = {};
    headers.forEach((h, i) => {
      if (h) record[h] = cells[i] ?? '';
    });
    return record;
  });
}

export function parseImportText(text: string): RawImportRecord[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { movies?: unknown }).movies)
        ? (parsed as { movies: unknown[] }).movies
        : Array.isArray((parsed as { list?: unknown }).list)
          ? (parsed as { list: unknown[] }).list
          : [];
    return arr.filter((item): item is RawImportRecord => typeof item === 'object' && item !== null);
  }
  return parseCsv(trimmed);
}

interface MovieIdentity {
  key: string;
  id: string | null;
}

function identityOf(id: string | null, title: string, year: number): MovieIdentity {
  const titleKey = normalizeTitle(title);
  const yearKey = year === UNKNOWN_YEAR ? 'unknown' : String(year);
  return { key: `${titleKey}|${yearKey}`, id };
}

interface ExistingMatch {
  match?: Movie;
  ambiguous?: Movie[];
}

function findExisting(existing: Movie[], record: NormalizedImport): ExistingMatch {
  if (record.id) {
    const byId = existing.find((m) => m.id === record.id);
    if (byId) return { match: byId };
  }
  const titleKey = normalizeTitle(record.title);
  const sameTitle = existing.filter((m) => normalizeTitle(m.title) === titleKey);
  if (sameTitle.length === 0) return {};
  if (record.year !== UNKNOWN_YEAR) {
    const byYear = sameTitle.find((m) => m.year === record.year || m.year === UNKNOWN_YEAR);
    if (byYear) return { match: byYear };
  }
  const unknownYear = sameTitle.find((m) => m.year === UNKNOWN_YEAR);
  if (unknownYear) return { match: unknownYear };
  if (sameTitle.length === 1) return { match: sameTitle[0] };
  return { ambiguous: sameTitle };
}

const MERGEABLE_FIELDS = ['year', 'genre', 'director', 'plot', 'poster'] as const;

function isMissing(movie: Movie, field: (typeof MERGEABLE_FIELDS)[number]): boolean {
  const value = movie[field];
  if (field === 'year') return value === UNKNOWN_YEAR;
  if (field === 'genre') return value === '' || value === UNKNOWN_GENRE;
  return value === '';
}

function hasIncomingValue(record: NormalizedImport, field: (typeof MERGEABLE_FIELDS)[number]): boolean {
  const value = record[field];
  if (field === 'year') return value !== UNKNOWN_YEAR;
  if (field === 'genre') return value !== '' && value !== UNKNOWN_GENRE;
  return value !== '';
}

function fillableFields(existing: Movie, record: NormalizedImport): string[] {
  return MERGEABLE_FIELDS.filter((f) => isMissing(existing, f) && hasIncomingValue(record, f));
}

function recordsEquivalent(a: NormalizedImport, b: NormalizedImport): boolean {
  return (
    normalizeTitle(a.title) === normalizeTitle(b.title) &&
    a.year === b.year &&
    a.genre === b.genre &&
    a.director === b.director &&
    a.plot === b.plot &&
    a.poster === b.poster &&
    a.personalRating === b.personalRating &&
    a.watchDate === b.watchDate &&
    a.watched === b.watched
  );
}

export interface MergeResult {
  movies: Movie[];
  report: ImportReport;
}

export function mergeImport(existing: Movie[], raws: RawImportRecord[], fileText: string, now?: string): MergeResult {
  const timestamp = now ?? new Date().toISOString();
  const fileHash = hashImportText(fileText);
  const items: ImportItemResult[] = [];
  const movies = [...existing];

  const normalized: (NormalizedImport | null)[] = raws.map((raw, i) => normalizeRecord(raw, i));

  const claimed = new Map<string, NormalizedImport>();

  for (let i = 0; i < raws.length; i++) {
    const record = normalized[i];
    if (!record) {
      items.push({
        index: i,
        status: 'skipped',
        title: '(无标题)',
        reason: '缺少标题，无法识别该条记录',
        source: raws[i],
      });
      continue;
    }

    const identity = identityOf(record.id, record.title, record.year);
    const claimKeys = [identity.key, ...(record.id ? [`id:${record.id}`] : [])];
    const prior = claimKeys.map((k) => claimed.get(k)).find((c) => c !== undefined);

    if (prior) {
      if (recordsEquivalent(prior, record)) {
        items.push({
          index: i,
          status: 'duplicate',
          title: record.title,
          reason: `与第 ${prior.index + 1} 条记录重复，已忽略`,
          source: raws[i],
        });
      } else {
        items.push({
          index: i,
          status: 'conflict',
          title: record.title,
          reason: `与第 ${prior.index + 1} 条记录指向同一影片但字段不一致，保留双方来源信息，待人工裁决`,
          source: raws[i],
        });
      }
      continue;
    }

    const found = findExisting(movies, record);
    if (found.ambiguous) {
      items.push({
        index: i,
        status: 'conflict',
        title: record.title,
        reason: `收藏中存在 ${found.ambiguous.length} 条同名候选（${found.ambiguous.map((m) => m.id).join('、')}），无法确定归属，待人工裁决`,
        source: raws[i],
      });
      continue;
    }
    const match = found.match;
    if (match) {
      const filled = fillableFields(match, record);
      if (filled.length > 0) {
        const idx = movies.findIndex((m) => m.id === match.id);
        const patched = { ...movies[idx] };
        for (const f of filled) {
          (patched as unknown as Record<string, unknown>)[f] = record[f as keyof NormalizedImport];
        }
        movies[idx] = patched;
        items.push({
          index: i,
          status: 'updated',
          title: record.title,
          matchedId: match.id,
          filledFields: filled,
          reason: `已存在，仅补齐缺失字段：${filled.join('、')}；个人评分/观影日期/观看状态保持不变`,
        });
      } else {
        items.push({
          index: i,
          status: 'unchanged',
          title: record.title,
          matchedId: match.id,
          reason: '已存在且无缺失字段可补齐，个人数据保持不变',
        });
      }
    } else {
      const id = record.id ?? `imp-${hashString(identity.key)}`;
      const movie: Movie = {
        id,
        title: record.title,
        year: record.year,
        director: record.director,
        plot: record.plot,
        poster: record.poster,
        genre: record.genre,
        personalRating: record.personalRating,
        watchDate: record.watchDate,
        watched: record.watched,
        addedAt: record.addedAt ?? timestamp,
      };
      movies.unshift(movie);
      const issueNote = record.issues.length > 0 ? `；归一化：${record.issues.map((x) => x.note).join('；')}` : '';
      items.push({
        index: i,
        status: 'added',
        title: record.title,
        matchedId: id,
        reason: `新增条目${issueNote}`,
      });
    }

    claimed.set(identity.key, record);
    if (record.id) claimed.set(`id:${record.id}`, record);
  }

  const count = (s: ImportItemResult['status']) => items.filter((it) => it.status === s).length;
  const report: ImportReport = {
    fileHash,
    total: raws.length,
    items,
    added: count('added'),
    updated: count('updated'),
    unchanged: count('unchanged'),
    duplicate: count('duplicate'),
    conflict: count('conflict'),
    skipped: count('skipped'),
  };
  return { movies, report };
}
