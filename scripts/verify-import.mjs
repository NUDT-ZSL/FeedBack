import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeImport, parseImportText, normalizeRecord } from '../.verify/utils/importer.js';

const NOW = '2026-01-01T00:00:00.000Z';

const seed = [
  {
    id: 'tt0133093', title: 'The Matrix', year: 1999,
    director: 'Lana Wachowski, Lilly Wachowski', plot: '', poster: '',
    genre: 'Action, Sci-Fi', personalRating: 9.0, watchDate: '2020-05-01',
    watched: true, addedAt: '2020-05-02T00:00:00.000Z',
  },
  {
    id: 'tt0468569', title: 'The Dark Knight', year: 2008,
    director: 'Christopher Nolan', plot: '', poster: '',
    genre: 'Action', personalRating: 9.5, watchDate: '2021-01-15',
    watched: true, addedAt: '2021-01-16T00:00:00.000Z',
  },
  {
    id: 'tt1375666', title: 'Inception', year: 2010,
    director: '', plot: '', poster: '',
    genre: '', personalRating: null, watchDate: null,
    watched: false, addedAt: '2022-03-01T00:00:00.000Z',
  },
];

const sampleText = readFileSync(new URL('../samples/sample-import.json', import.meta.url), 'utf-8');
const raws = parseImportText(sampleText);
assert.equal(raws.length, 10, 'sample must parse to 10 raw records');

const run1 = mergeImport(seed, raws, sampleText, NOW);
const run2 = mergeImport(run1.movies, raws, sampleText, NOW);

const byTitle = (list, t) => list.find((m) => m.title === t);

assert.equal(run1.movies.length, 7, '3 seed + 4 new entries');
assert.equal(run2.movies.length, 7, 'second import must not add duplicates');
assert.deepEqual(
  run2.movies.map((m) => `${m.id}|${m.addedAt}`).sort(),
  run1.movies.map((m) => `${m.id}|${m.addedAt}`).sort(),
  'merged set must be stable across reruns',
);

const matrix = byTitle(run2.movies, 'The Matrix');
assert.equal(matrix.personalRating, 9.0, 'external rating must not overwrite personal rating');
assert.equal(matrix.watched, true, 'external status must not overwrite watched');
assert.equal(matrix.watchDate, '2020-05-01', 'external watch date must not overwrite watch date');
assert.equal(matrix.genre, 'Action, Sci-Fi', 'external genre must not overwrite filled genre');

const inception = byTitle(run2.movies, 'Inception');
assert.equal(inception.genre, 'Sci-Fi, Thriller', 'missing genre should be filled');
assert.equal(inception.director, 'Christopher Nolan', 'missing director should be filled');
assert.equal(inception.personalRating, null, 'filling fields must not inject personal data');
assert.equal(inception.watched, false, 'filling fields must not change watched');

const unknown = byTitle(run2.movies, 'Unknown Flick');
assert.equal(unknown.year, 0, 'invalid year -> 0 (unknown)');
assert.equal(unknown.genre, '未知', 'missing genre -> 未知');
assert.equal(unknown.personalRating, null, 'invalid rating -> null (unknown)');
assert.equal(unknown.watched, false, 'invalid status -> false');

const spirited = byTitle(run2.movies, 'Spirited Away');
assert.equal(spirited.watchDate, '2023-06-15', 'slash date should be normalized to ISO');
assert.equal(spirited.watched, true, 'Chinese watched token should normalize');

const r1Statuses = run1.report.items.map((i) => `${i.index}:${i.status}`);
assert.ok(r1Statuses.includes('0:unchanged'), 'Matrix: existing, nothing fillable -> unchanged');
assert.ok(r1Statuses.includes('1:unchanged'), 'case-insensitive title match -> unchanged');
assert.ok(r1Statuses.includes('2:updated'), 'Inception: missing fields filled -> updated');
assert.ok(r1Statuses.includes('3:added'), 'Spirited Away: added');
assert.ok(r1Statuses.includes('4:duplicate'), 'whitespace-duplicate -> duplicate');
assert.ok(r1Statuses.includes('5:added'), 'Unknown Flick normalized but kept');
assert.ok(r1Statuses.includes('6:skipped'), 'missing title -> skipped with reason');
assert.ok(r1Statuses.includes('7:added'), 'Shawshank: added by id');
assert.ok(r1Statuses.includes('8:added'), 'Interstellar first copy: added');
assert.ok(r1Statuses.includes('9:conflict'), 'Interstellar second copy: conflict for adjudication');

const skipped = run1.report.items.find((i) => i.index === 6);
assert.ok(skipped.reason.includes('缺少标题'), 'skip reason must be explicit');
assert.ok(skipped.source && skipped.source.year === '2005', 'source record must be retained');
const conflict = run1.report.items.find((i) => i.index === 9);
assert.ok(conflict.reason.includes('人工裁决'), 'conflict reason must explain adjudication');
assert.equal(conflict.source.genre, 'Adventure', 'conflict source info must be retained');

for (const idx of [4, 6, 9]) {
  const a = run1.report.items.find((i) => i.index === idx);
  const b = run2.report.items.find((i) => i.index === idx);
  assert.deepEqual(
    { status: a.status, reason: a.reason },
    { status: b.status, reason: b.reason },
    `conflict/skip/dup explanation for #${idx + 1} must be stable`,
  );
}
assert.equal(run2.report.added, 0, 'second import adds nothing');
assert.equal(run2.report.updated, 0, 'second import fills nothing');
assert.equal(run2.report.conflict, 1, 'conflict still surfaces on rerun');
assert.equal(run2.report.skipped, 1, 'skip still surfaces on rerun');

const filterSort = (movies, filter) => {
  let result = [...movies];
  if (filter.year !== null) result = result.filter((m) => m.year === filter.year);
  if (filter.minRating !== null) result = result.filter((m) => (m.personalRating ?? 0) >= filter.minRating);
  if (filter.watched !== null) result = result.filter((m) => m.watched === filter.watched);
  result.sort((a, b) => {
    const av = filter.sortBy === 'rating' ? a.personalRating ?? -1 : a.addedAt;
    const bv = filter.sortBy === 'rating' ? b.personalRating ?? -1 : b.addedAt;
    if (av < bv) return filter.sortOrder === 'asc' ? -1 : 1;
    if (av > bv) return filter.sortOrder === 'asc' ? 1 : -1;
    return 0;
  });
  return result;
};

const year1999 = filterSort(run2.movies, { year: 1999, minRating: null, watched: null, sortBy: 'addedAt', sortOrder: 'desc' });
assert.deepEqual(year1999.map((m) => m.title), ['The Matrix'], 'year filter on merged set');

const rating9desc = filterSort(run2.movies, { year: null, minRating: 9, watched: null, sortBy: 'rating', sortOrder: 'desc' });
assert.deepEqual(
  rating9desc.map((m) => m.title),
  ['The Shawshank Redemption', 'The Dark Knight', 'Spirited Away', 'The Matrix'],
  'rating filter+sort on merged set',
);

const watchedList = filterSort(run2.movies, { year: null, minRating: null, watched: true, sortBy: 'addedAt', sortOrder: 'desc' }).map((m) => m.title);
assert.ok(watchedList.includes('Spirited Away'), 'normalized Chinese watched token appears in 已看 view');
assert.ok(!watchedList.includes('Unknown Flick'), 'invalid-status record excluded from 已看 view');

const addedDesc = filterSort(run2.movies, { year: null, minRating: null, watched: null, sortBy: 'addedAt', sortOrder: 'desc' }).map((m) => m.title);
assert.deepEqual(addedDesc.slice(0, 4), ['Interstellar', 'The Shawshank Redemption', 'Unknown Flick', 'Spirited Away'], 'new records sort by import time');

const csvText = readFileSync(new URL('../samples/sample-import.csv', import.meta.url), 'utf-8');
const csvRows = parseImportText(csvText);
assert.equal(csvRows.length, 3, 'CSV should parse 3 rows');
const csvNorm = normalizeRecord(csvRows[1], 1);
assert.equal(csvNorm.title, 'pulp fiction', 'CSV trims surrounding whitespace');
assert.equal(csvNorm.year, 1994);
assert.equal(csvNorm.watched, true, 'CSV 已看 token');
assert.equal(csvNorm.genre, 'Crime');
assert.equal(csvNorm.id, 'tt0110912');
const csvUnknown = normalizeRecord(csvRows[2], 2);
assert.equal(csvUnknown.year, 0, 'CSV unknown year -> 0');
assert.equal(csvUnknown.genre, '未知');

console.log('all import verification assertions passed');
