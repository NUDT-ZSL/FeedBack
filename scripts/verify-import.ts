/*
 * 离线验收脚本：node scripts/verify-import.ts
 * 使用包含重复、字段缺失、格式异常、与现有收藏冲突的样例片单，
 * 连续导入两次并执行人工裁决，验证合并结果的稳定性与筛选一致性。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Movie, FilterState } from '../src/types/index.ts';
import { normalizeAll, UNKNOWN } from '../src/utils/import/normalize.ts';
import { computeBatchId, runImport } from '../src/utils/import/mergeImport.ts';
import { parseImportText, parseCsv } from '../src/utils/import/parse.ts';
import { applyFilter } from '../src/utils/filterMovies.ts';
import type { ImportReport, PendingDecision } from '../src/utils/import/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-01-01T00:00:00.000Z';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

// ---------- 现有收藏（含个人数据，导入不得覆盖） ----------
const existing: Movie[] = [
  {
    id: 'tt0110912',
    title: 'Pulp Fiction',
    year: 1994,
    director: 'Quentin Tarantino',
    plot: 'Lives of mob hitmen...',
    poster: 'pulp.jpg',
    genre: 'Crime, Drama',
    personalRating: 9.5,
    watchDate: '2024-01-10',
    watched: true,
    addedAt: '2024-01-10T00:00:00.000Z',
  },
  {
    id: 'tt0068646',
    title: 'The Godfather',
    year: 1972,
    director: 'Francis Ford Coppola',
    plot: 'Corleone family...',
    poster: 'godfather.jpg',
    genre: 'Crime, Drama',
    personalRating: null,
    watchDate: null,
    watched: false,
    addedAt: '2024-02-01T00:00:00.000Z',
  },
  {
    id: 'tt0133093',
    title: 'The Matrix',
    year: 1999,
    director: '',
    plot: 'A hacker learns...',
    poster: 'matrix.jpg',
    genre: 'Action, Sci-Fi',
    personalRating: 8,
    watchDate: null,
    watched: null,
    addedAt: '2024-03-01T00:00:00.000Z',
  },
];

const rawText = readFileSync(join(here, '../examples/sample-import.json'), 'utf8');
const raw = parseImportText(rawText);
const batchId = computeBatchId(raw);

// 模拟 localStorage 中的裁决存储
const decisionStore = new Map<string, Record<string, PendingDecision>>();
const getDecisions = () => decisionStore.get(batchId) ?? {};

function runOnce(movies: Movie[]): { movies: Movie[]; report: ImportReport } {
  return runImport({
    existing: movies,
    records: normalizeAll(raw),
    batchId,
    decisions: getDecisions(),
    now: NOW,
  });
}

console.log('\n[1] 字段归一化');
const normalized = normalizeAll(raw);
const byRow = (row: number) => normalized.find((r) => r.row === row)!;
check('非法年份归为未知并给出告警', byRow(7).year === null && byRow(7).issues.some((i) => i.code === 'year_invalid'));
check('越界评分归为未知并给出告警', byRow(7).rating === null && byRow(7).issues.some((i) => i.code === 'rating_out_of_range'));
check('非法观看状态归为未知并给出告警', byRow(7).watched === null && byRow(7).issues.some((i) => i.code === 'watched_invalid'));
check('非法观影日期归为未知并给出告警', byRow(10).watchDate === null && byRow(10).issues.some((i) => i.code === 'date_invalid'));
check('合法变体日期被归一为 ISO 格式', byRow(3).watchDate === '2023-11-02');
check('文本评分被解析为数值', byRow(5).rating === 8.5);
check('观看状态同义词被识别', byRow(5).watched === true && byRow(13).watched === true);
check('缺失类型归为「未知」', byRow(7).genre.join(',') === UNKNOWN);
check('缺字段的记录没有被静默丢弃', normalized.length === 15);

console.log('\n[2] 第一次导入');
const run1 = runOnce(existing);
const r1 = run1.report;
check('新增 4 条', r1.added === 4, `实际 ${r1.added}`);
check('合并 3 条', r1.merged === 3, `实际 ${r1.merged}`);
check('重复 3 条', r1.duplicate === 3, `实际 ${r1.duplicate}`);
check('待裁决 3 条', r1.pending === 3, `实际 ${r1.pending}`);
check('跳过 2 条', r1.skipped === 2, `实际 ${r1.skipped}`);
check('收藏数量 3 + 4 = 7', run1.movies.length === 7, `实际 ${run1.movies.length}`);

const pulp = run1.movies.find((m) => m.id === 'tt0110912')!;
check('已有记录个人评分未被覆盖', pulp.personalRating === 9.5);
check('已有记录观看状态未被覆盖', pulp.watched === true);
check('已有记录观影日期未被覆盖', pulp.watchDate === '2024-01-10');

const matrix = run1.movies.find((m) => m.id === 'tt0133093')!;
check('缺失的观看状态被补齐', matrix.watched === true);
check('缺失的观影日期被补齐', matrix.watchDate === '2024-06-01');
check('缺失的导演被补齐', matrix.director === 'The Wachowskis');
check('已有个人评分不被导入数据改写', matrix.personalRating === 8);

const darkKnight = run1.movies.find((m) => m.id === 'tt0468569')!;
check('新记录日期归一后入库', darkKnight.watchDate === '2023-11-02');
check('新记录类型归一后入库', darkKnight.genre === 'Action, Crime, Drama');
check('同 id 重复行只入库一次', run1.movies.filter((m) => m.id === 'tt0468569').length === 1);
check('大小写/空格差异的标题被识别为重复', r1.recordResults.find((r) => r.row === 2)?.action === 'merged');
check('无 id 但标题+年份匹配的行被合并而非新增', r1.recordResults.find((r) => r.row === 6)?.action === 'duplicate');

const pendingRows = r1.recordResults.filter((r) => r.action === 'pending');
check('标识缺失的记录进入待裁决并说明原因', pendingRows.some((r) => r.row === 7 && /标识/.test(r.reason ?? '')));
check('标识冲突的记录进入待裁决并保留候选', pendingRows.some((r) => r.row === 9 && (r.candidates ?? []).some((c) => c.id === 'tt0068646')));
check('待裁决记录保留来源信息', pendingRows.every((r) => (r.candidates ?? []).every((c) => typeof c.source === 'string')));
const skippedRows = r1.recordResults.filter((r) => r.action === 'skipped');
check('缺片名的记录被跳过并说明原因', skippedRows.some((r) => r.row === 11 && /片名/.test(r.reason ?? '')));
check('非对象记录被跳过并说明原因', skippedRows.some((r) => r.row === 12 && (r.reason ?? '').length > 0));

console.log('\n[3] 第二次导入（幂等性）');
const run2 = runOnce(run1.movies);
const r2 = run2.report;
check('重复导入不产生新条目', run2.movies.length === run1.movies.length);
check('重复导入后收藏内容完全一致', JSON.stringify(run2.movies) === JSON.stringify(run1.movies));
check('第二次导入新增为 0', r2.added === 0);
let transitionOk = true;
for (const a of r1.recordResults) {
  const b = r2.recordResults.find((x) => x.row === a.row)!;
  if (a.action === 'pending' || a.action === 'skipped') {
    if (b.action !== a.action || b.reason !== a.reason) transitionOk = false;
  } else if (a.action === 'added' || a.action === 'duplicate' || a.action === 'merged') {
    if (b.action !== 'merged' || b.targetId !== a.targetId) transitionOk = false;
  } else {
    if (b.action !== a.action || b.targetId !== a.targetId) transitionOk = false;
  }
}
check('每条记录的处理结论稳定（冲突记录说明不变，新增项稳定并入同一目标）', transitionOk);

console.log('\n[4] 人工裁决与裁决幂等');
const pendingClusters = r2.pendingClusters;
const mysteryKey = pendingClusters.find((c) => c.records.some((r) => r.row === 7))!.clusterKey;
const lostKey = pendingClusters.find((c) => c.records.some((r) => r.row === 8))!.clusterKey;
const godfatherKey = pendingClusters.find((c) => c.records.some((r) => r.row === 9))!.clusterKey;
decisionStore.set(batchId, {
  [mysteryKey]: { type: 'add', recordId: 'row:7', decidedAt: NOW },
  [lostKey]: { type: 'skip', decidedAt: NOW },
  [godfatherKey]: { type: 'skip', decidedAt: NOW },
});
const run3 = runOnce(run2.movies);
const r3 = run3.report;
check('裁决后无待裁决记录', r3.pending === 0, `实际 ${r3.pending}`);
check('裁决新增 1 条（标识缺失影片）', run3.movies.length === 8, `实际 ${run3.movies.length}`);
const mystery = run3.movies.find((m) => m.title === 'Mystery Movie')!;
check('裁决新增的记录生成稳定 id', mystery.id.startsWith('import-'));
check('裁决新增记录未知字段保持「未知」', mystery.year === null && mystery.personalRating === null && mystery.genre === UNKNOWN);
const godfather = run3.movies.find((m) => m.id === 'tt0068646')!;
check('裁决跳过后收藏记录不受影响', godfather.personalRating === null && run3.movies.every((m) => m.id !== 'tt9999999'));

const run4 = runOnce(run3.movies);
check('裁决结果不被重复导入改写', JSON.stringify(run4.movies) === JSON.stringify(run3.movies));
check('裁决在重复导入时稳定复用', run4.report.decisionsApplied.length === 3);
const row7run4 = run4.report.recordResults.find((r) => r.row === 7)!;
check(
  '已裁决新增的条目在重复导入时并入而非重复添加',
  row7run4.action === 'merged' && row7run4.targetId === mystery.id,
);
let decisionTransitionOk = true;
for (const a of r3.recordResults) {
  if (a.row === 7) continue;
  const b = run4.report.recordResults.find((x) => x.row === a.row)!;
  if (a.action === 'pending' || a.action === 'skipped') {
    if (b.action !== a.action || b.reason !== a.reason) decisionTransitionOk = false;
  } else if (b.action !== a.action || b.targetId !== a.targetId) {
    decisionTransitionOk = false;
  }
}
check('其余记录的处理结论在裁决后依然稳定', decisionTransitionOk);

console.log('\n[5] 筛选与排序一致性（基于合并后的真实集合）');
const movies = run4.movies;
const baseFilter: FilterState = { year: null, minRating: null, watched: null, sortBy: 'addedAt', sortOrder: 'desc' };
const yearFilter = applyFilter(movies, { ...baseFilter, year: 1994 });
check('年份筛选命中合并后的真实集合', yearFilter.map((m) => m.id).sort().join(',') === 'tt0109830,tt0110912');
const ratingFilter = applyFilter(movies, { ...baseFilter, minRating: 9 });
check('评分筛选命中合并后的真实集合', ratingFilter.length === 3 && ratingFilter.every((m) => (m.personalRating ?? 0) >= 9));
const watchedFilter = applyFilter(movies, { ...baseFilter, watched: true });
check('已看筛选与真实集合一致', watchedFilter.length === 6 && watchedFilter.every((m) => m.watched === true));
const unwatchedFilter = applyFilter(movies, { ...baseFilter, watched: false });
check('未看筛选与真实集合一致', unwatchedFilter.length === 1 && unwatchedFilter[0].id === 'tt0068646');
const byRating = applyFilter(movies, { ...baseFilter, sortBy: 'rating', sortOrder: 'desc' });
const ratings = byRating.map((m) => m.personalRating ?? -1);
check('评分排序正确', ratings.every((v, i) => i === 0 || ratings[i - 1] >= v));
check('评分排序榜首为最高分收藏', byRating[0].id === 'tt0110912');
const byAdded = applyFilter(movies, { ...baseFilter, sortBy: 'addedAt', sortOrder: 'asc' });
const addedAts = byAdded.map((m) => m.addedAt);
check('添加时间排序正确', addedAts.every((v, i) => i === 0 || addedAts[i - 1] <= v));
check('筛选不遗漏任何记录（全集数量）', applyFilter(movies, baseFilter).length === movies.length);

console.log('\n[6] 解析器');
const csvMovies = parseCsv('title,year,rating\nFoo,2001,7\nBar,2002,8');
check('CSV 解析出正确行数', csvMovies.length === 2 && csvMovies[0].title === 'Foo');
check('JSON 包装对象可解析', (parseImportText('{"movies":[{"title":"X"}]}') as unknown[]).length === 1);

console.log(failures === 0 ? '\n全部验收项通过 ✅' : `\n${failures} 项未通过 ❌`);
process.exit(failures === 0 ? 0 : 1);
