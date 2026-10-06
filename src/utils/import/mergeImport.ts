import type { Movie } from '../../types/index.ts';
import { UNKNOWN } from './normalize.ts';
import type {
  ImportReport,
  ImportRecordResult,
  MergeCandidate,
  NormalizedRecord,
  PendingCluster,
  PendingDecision,
} from './types.ts';

export function titleKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function computeBatchId(records: unknown[]): string {
  return 'batch-' + fnv1a(JSON.stringify(records));
}

export interface EngineOptions {
  existing: Movie[];
  records: NormalizedRecord[];
  batchId: string;
  decisions?: Record<string, PendingDecision>;
  now?: string;
}

export interface EngineResult {
  movies: Movie[];
  report: ImportReport;
}

class Dsu {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r];
    while (this.parent[x] !== r) {
      const next = this.parent[x];
      this.parent[x] = r;
      x = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

function hasError(rec: NormalizedRecord): boolean {
  return rec.issues.some((i) => i.level === 'error');
}

function firstDefined<T>(recs: NormalizedRecord[], pick: (r: NormalizedRecord) => T | null): { value: T; row: number } | null {
  for (const r of recs) {
    const v = pick(r);
    if (v !== null && v !== undefined && (v as unknown) !== '') return { value: v, row: r.row };
  }
  return null;
}

function fillMissing(movie: Movie, recs: NormalizedRecord[]): Map<string, number> {
  const contributors = new Map<string, number>();
  const year = movie.year === null ? firstDefined(recs, (r) => r.year) : null;
  if (year) {
    movie.year = year.value;
    contributors.set('year', year.row);
  }
  const director = movie.director === '' ? firstDefined(recs, (r) => (r.director ? r.director : null)) : null;
  if (director) {
    movie.director = director.value;
    contributors.set('director', director.row);
  }
  if (movie.genre === '' || movie.genre === UNKNOWN) {
    const genre = firstDefined(recs, (r) => {
      const g = r.genre.filter((x) => x !== UNKNOWN);
      return g.length > 0 ? g.join(', ') : null;
    });
    if (genre) {
      movie.genre = genre.value;
      contributors.set('genre', genre.row);
    }
  }
  const rating = movie.personalRating === null ? firstDefined(recs, (r) => r.rating) : null;
  if (rating) {
    movie.personalRating = rating.value;
    contributors.set('personalRating', rating.row);
  }
  const watchDate = movie.watchDate === null ? firstDefined(recs, (r) => r.watchDate) : null;
  if (watchDate) {
    movie.watchDate = watchDate.value;
    contributors.set('watchDate', watchDate.row);
  }
  const watched = movie.watched === null ? firstDefined(recs, (r) => r.watched) : null;
  if (watched) {
    movie.watched = watched.value;
    contributors.set('watched', watched.row);
  }
  return contributors;
}

function toMovie(rec: NormalizedRecord, now: string): Movie {
  const id =
    rec.externalId ?? `import-${fnv1a(`${titleKey(rec.title)}|${rec.year ?? 'unknown'}`)}`;
  return {
    id,
    title: rec.title,
    year: rec.year,
    director: rec.director,
    plot: '',
    poster: '',
    genre: rec.genre.join(', '),
    personalRating: rec.rating,
    watchDate: rec.watchDate,
    watched: rec.watched,
    addedAt: now,
    source: rec.source,
  };
}

function existingCandidate(m: Movie, reason: string): MergeCandidate {
  return { kind: 'existing', id: m.id, title: m.title, year: m.year, source: m.source ?? '收藏', reason };
}

function importCandidate(rec: NormalizedRecord, reason: string): MergeCandidate {
  return {
    kind: 'import',
    id: rec.externalId ?? `row:${rec.row}`,
    title: rec.title,
    year: rec.year,
    source: rec.source,
    reason,
  };
}

export function runImport(opts: EngineOptions): EngineResult {
  const now = opts.now ?? new Date().toISOString();
  const decisions = opts.decisions ?? {};
  const existing = opts.existing.map((m) => ({ ...m }));
  const records = [...opts.records].sort((a, b) => a.row - b.row);
  const n = existing.length;
  const m = records.length;
  const dsu = new Dsu(n + m);

  const validRecIdx: number[] = [];
  const skippedResults: ImportRecordResult[] = [];
  records.forEach((rec, j) => {
    if (hasError(rec)) {
      skippedResults.push({
        row: rec.row,
        title: rec.title || '(无片名)',
        year: rec.year,
        source: rec.source,
        action: 'skipped',
        issues: rec.issues,
        reason: rec.issues.filter((i) => i.level === 'error').map((i) => i.message).join('；'),
        clusterKey: `row:${rec.row}`,
      });
    } else {
      validRecIdx.push(j);
    }
  });

  const yearOf = (idx: number): number | null => (idx < n ? existing[idx].year : records[idx - n].year);

  const byId = new Map<string, number[]>();
  existing.forEach((movie, i) => {
    if (movie.id) {
      const arr = byId.get(movie.id) ?? [];
      arr.push(i);
      byId.set(movie.id, arr);
    }
  });
  validRecIdx.forEach((j) => {
    const id = records[j].externalId;
    if (id) {
      const arr = byId.get(id) ?? [];
      arr.push(n + j);
      byId.set(id, arr);
    }
  });
  for (const group of byId.values()) {
    for (let k = 1; k < group.length; k++) dsu.union(group[0], group[k]);
  }

  const byTitle = new Map<string, number[]>();
  existing.forEach((movie, i) => {
    const key = titleKey(movie.title);
    if (key) {
      const arr = byTitle.get(key) ?? [];
      arr.push(i);
      byTitle.set(key, arr);
    }
  });
  validRecIdx.forEach((j) => {
    const key = titleKey(records[j].title);
    if (key) {
      const arr = byTitle.get(key) ?? [];
      arr.push(n + j);
      byTitle.set(key, arr);
    }
  });
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const byYear = new Map<number, number[]>();
    const nullYear: number[] = [];
    for (const idx of group) {
      const y = yearOf(idx);
      if (y === null) nullYear.push(idx);
      else {
        const arr = byYear.get(y) ?? [];
        arr.push(idx);
        byYear.set(y, arr);
      }
    }
    for (const sameYear of byYear.values()) {
      for (let k = 1; k < sameYear.length; k++) dsu.union(sameYear[0], sameYear[k]);
    }
    for (const idx of nullYear) dsu.union(group[0], idx);
  }

  const clusters = new Map<number, { existingIdxs: number[]; recIdxs: number[] }>();
  const clusterOf = (idx: number) => {
    const root = dsu.find(idx);
    let c = clusters.get(root);
    if (!c) {
      c = { existingIdxs: [], recIdxs: [] };
      clusters.set(root, c);
    }
    return c;
  };
  existing.forEach((_, i) => clusterOf(i).existingIdxs.push(i));
  validRecIdx.forEach((j) => clusterOf(n + j).recIdxs.push(j));

  const recordResults: ImportRecordResult[] = [...skippedResults];
  const pendingClusters: PendingCluster[] = [];
  const decisionsApplied: string[] = [];
  const newMovies: Movie[] = [];

  const sortedClusters = [...clusters.values()]
    .filter((c) => c.recIdxs.length > 0)
    .sort((a, b) => records[a.recIdxs[0]].row - records[b.recIdxs[0]].row);

  for (const cluster of sortedClusters) {
    const recs = cluster.recIdxs.map((j) => records[j]).sort((a, b) => a.row - b.row);
    const exs = cluster.existingIdxs.map((i) => existing[i]);
    const extIds = [...new Set(recs.map((r) => r.externalId).filter((x): x is string => !!x))].sort();
    const knownYears = [...new Set(recs.map((r) => r.year).filter((y): y is number => y !== null))].sort();
    const incomingKey =
      extIds.length > 0
        ? `ext:${extIds[0]}`
        : `title:${titleKey(recs[0].title)}:${knownYears[0] ?? 'unknown'}`;
    const clusterKey =
      exs.length > 0 ? `movie:${[...exs.map((e) => e.id)].sort()[0]}` : incomingKey;

    const baseResult = (rec: NormalizedRecord): ImportRecordResult => ({
      row: rec.row,
      title: rec.title,
      year: rec.year,
      source: rec.source,
      action: 'pending',
      issues: rec.issues,
      clusterKey,
    });

    const decisionKey = decisions[clusterKey] ? clusterKey : decisions[incomingKey] ? incomingKey : null;
    const decision = decisionKey ? decisions[decisionKey] : undefined;

    const applyMerge = (target: Movie, note?: string) => {
      const contributors = fillMissing(target, recs);
      for (const rec of recs) {
        const filled = [...contributors.entries()].filter(([, row]) => row === rec.row).map(([f]) => f);
        recordResults.push({
          ...baseResult(rec),
          action: 'merged',
          targetId: target.id,
          filledFields: filled,
          reason:
            note ??
            `与收藏《${target.title}》为同一影片：个人评分/观影日期/观看状态不覆盖，仅按需补齐缺失字段`,
        });
      }
    };

    const applyAdd = (canonical: NormalizedRecord, note?: string) => {
      const movie = toMovie(canonical, now);
      const already = existing.find((mv) => mv.id === movie.id) ?? newMovies.find((mv) => mv.id === movie.id);
      if (already) {
        applyMerge(already, note ?? `裁决目标《${already.title}》已存在于收藏，按裁决并入且不改写已有数据`);
        return;
      }
      newMovies.push(movie);
      for (const rec of recs) {
        if (rec.row === canonical.row) {
          recordResults.push({
            ...baseResult(rec),
            action: 'added',
            targetId: movie.id,
            reason: note ?? `新增收藏《${movie.title}》`,
          });
        } else {
          recordResults.push({
            ...baseResult(rec),
            action: 'duplicate',
            targetId: movie.id,
            reason: `与第 ${canonical.row} 行指向同一影片，已合并为同一条目`,
          });
        }
      }
    };

    const applySkip = (reason: string) => {
      for (const rec of recs) {
        recordResults.push({ ...baseResult(rec), action: 'skipped', reason });
      }
    };

    const markPending = (reason: string, candidates: MergeCandidate[]) => {
      for (const rec of recs) {
        recordResults.push({ ...baseResult(rec), action: 'pending', candidates, reason });
      }
      pendingClusters.push({
        clusterKey,
        reason,
        candidates,
        records: recs.map((r) => ({ row: r.row, title: r.title, year: r.year, source: r.source })),
      });
    };

    if (decision && decisionKey) {
      decisionsApplied.push(decisionKey);
      if (decision.type === 'skip') {
        applySkip('已按人工裁决跳过该条目');
      } else if (decision.type === 'merge') {
        const target = existing.find((mv) => mv.id === decision.targetId) ?? newMovies.find((mv) => mv.id === decision.targetId);
        if (target) {
          applyMerge(target, `按人工裁决并入《${target.title}》，仅补齐缺失字段`);
        } else {
          markPending('裁决目标已不存在，请重新裁决', exs.map((e) => existingCandidate(e, '收藏记录')));
        }
      } else {
        const canonical = recs.find((r) => `row:${r.row}` === decision.recordId) ?? recs[0];
        applyAdd(canonical, '按人工裁决新增为收藏条目');
      }
      continue;
    }

    if (exs.length >= 2) {
      markPending(
        `该记录同时匹配到收藏中的 ${exs.length} 条记录，需人工裁决`,
        exs.map((e) => existingCandidate(e, '相同标识或相同片名（年份兼容）')),
      );
    } else if (exs.length === 1) {
      const target = exs[0];
      const conflicting = extIds.length > 0 && !extIds.includes(target.id);
      if (conflicting) {
        markPending(
          `外部标识（${extIds.join('、')}）与收藏记录标识（${target.id}）冲突，需人工裁决`,
          [existingCandidate(target, '片名与年份一致，但标识不同'), ...recs.map((r) => importCandidate(r, '导入记录'))],
        );
      } else {
        applyMerge(target);
      }
    } else if (extIds.length >= 2) {
      markPending(
        `同一片名年份对应 ${extIds.length} 个不同外部标识，需人工裁决`,
        recs.map((r) => importCandidate(r, r.externalId ? `外部标识 ${r.externalId}` : '无外部标识')),
      );
    } else if (extIds.length === 1) {
      const canonical = recs.find((r) => r.externalId === extIds[0]) ?? recs[0];
      applyAdd(canonical);
    } else {
      markPending(
        '缺少可识别的外部标识，无法确认是否为重复影片，需人工裁决',
        recs.map((r) => importCandidate(r, '无外部标识')),
      );
    }
  }

  recordResults.sort((a, b) => a.row - b.row);
  const count = (action: ImportRecordResult['action']) => recordResults.filter((r) => r.action === action).length;

  const report: ImportReport = {
    batchId: opts.batchId,
    importedAt: now,
    totalRows: records.length,
    added: count('added'),
    merged: count('merged'),
    duplicate: count('duplicate'),
    pending: count('pending'),
    skipped: count('skipped'),
    recordResults,
    pendingClusters,
    decisions: Object.values(decisions),
    decisionsApplied,
  };

  return { movies: [...existing, ...newMovies], report };
}
