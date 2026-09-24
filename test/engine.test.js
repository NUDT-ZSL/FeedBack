/* 引擎行为测试：node test/engine.test.js */
'use strict';
const assert = require('assert');
const GeoEngine = require('../js/engine.js');

const SAMPLE = JSON.parse(JSON.stringify({
  world: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  objects: [
    { objectId: 'obj-a', source: 'gps-1', coord: { x: 20, y: 20 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { objectId: 'obj-a', source: 'manual-1', coord: { x: 20, y: 20 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { objectId: 'obj-b', source: 'gps-2', coord: { x: 35, y: 25 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { objectId: 'obj-b', source: 'drone-1', coord: { x: 38, y: 28 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { objectId: 'obj-c', source: 'lora-1', category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { objectId: 'obj-d', source: 'gps-3', coord: { x: 150, y: 40 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { objectId: 'obj-e', source: 'sys-a', coord: { x: 60, y: 60 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-03-31' },
    { objectId: 'obj-e', source: 'sys-b', coord: { x: 60, y: 60 }, category: 'beacon', validFrom: '2026-09-01', validTo: '2026-12-31' },
    { objectId: 'obj-f', source: 'gps-4', coord: { x: 45, y: 30 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { objectId: 'obj-g', source: 'crm-1', coord: { x: 55, y: 35 }, category: 'vip', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { objectId: 'obj-g', source: 'field-2', coord: { x: 55, y: 35 }, category: 'regular', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { objectId: 'obj-h', source: 'gps-5', coord: { x: 40, y: 30 }, category: 'vip', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { objectId: 'obj-j', source: 'gps-7', coord: { x: 33, y: 33 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-06-30' }
  ],
  queries: [
    { id: 'Q1', shape: { type: 'circle', cx: 30, cy: 30, r: 15 }, filters: { categories: ['beacon', 'vip'], asOf: '2026-09-24' }, expectedBasis: [] },
    { id: 'Q2', shape: { type: 'rect', minX: 35, minY: 20, maxX: 60, maxY: 45 }, filters: { categories: ['vip'], asOf: '2026-09-24' }, expectedBasis: [] }
  ]
}));

function fresh() { const e = new GeoEngine.Engine(); e.importData(JSON.parse(JSON.stringify(SAMPLE))); return e; }
function res(eng, qid) { return eng.results.get(qid); }
function hitIds(eng, qid) { return res(eng, qid).hits.map(h => h.objectId); }

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ok -', name); }

console.log('engine tests');

t('可信对象正常命中并给出依据', () => {
  const e = fresh();
  assert.ok(hitIds(e, 'Q1').includes('obj-a'));
  const hit = res(e, 'Q1').hits.find(h => h.objectId === 'obj-a');
  assert.ok(hit.basis.some(b => b.includes('类别')));
  assert.ok(hit.basis.some(b => b.includes('有效期')));
});

t('坐标矛盾：保留双方来源、标不可信、不参与排序', () => {
  const e = fresh();
  const r = e.resolutions.get('obj-b');
  assert.strictEqual(r.trusted, false);
  const vals = r.fields.coord.candidates.filter(g => g.value).map(g => g.value);
  assert.deepStrictEqual(vals, [{ x: 35, y: 25 }, { x: 38, y: 28 }]);
  assert.ok(!hitIds(e, 'Q1').includes('obj-b'));
  const ex = res(e, 'Q1').excluded.find(x => x.objectId === 'obj-b');
  assert.ok(ex && ex.basis.join('').includes('不可信'));
});

t('坐标缺失与越界均标不可信', () => {
  const e = fresh();
  assert.strictEqual(e.resolutions.get('obj-c').trusted, false);
  assert.strictEqual(e.resolutions.get('obj-c').fields.coord.status, 'missing');
  assert.strictEqual(e.resolutions.get('obj-d').trusted, false);
  assert.ok(e.resolutions.get('obj-d').conflicts.join('').includes('越出世界边界'));
});

t('有效期互不相交标记矛盾', () => {
  const e = fresh();
  const r = e.resolutions.get('obj-e');
  assert.strictEqual(r.trusted, false);
  assert.ok(r.conflicts.join('').includes('互不相交'));
});

t('压线对象纳入命中并标歧义', () => {
  const e = fresh();
  const hit = res(e, 'Q1').hits.find(h => h.objectId === 'obj-f');
  assert.ok(hit, 'obj-f 应命中（闭区间含边界）');
  assert.ok(hit.ambiguities.length > 0);
});

t('类别矛盾对象不可信；有效期过期被排除并说明', () => {
  const e = fresh();
  assert.strictEqual(e.resolutions.get('obj-g').trusted, false);
  const ex = res(e, 'Q1').excluded.find(x => x.objectId === 'obj-j');
  assert.ok(ex && ex.basis.join('').includes('有效期'));
});

t('邻近顺序按距离升序且排名连续', () => {
  const e = fresh();
  const hits = res(e, 'Q1').hits;
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i].distance >= hits[i - 1].distance);
  hits.forEach((h, i) => assert.strictEqual(h.rank, i + 1));
});

t('范围重叠产生歧义说明', () => {
  const e = fresh();
  assert.ok(res(e, 'Q1').ambiguities.join('').includes('Q2'));
  assert.ok(res(e, 'Q2').ambiguities.join('').includes('Q1'));
});

function assertConsistent(e, msg) {
  const before = JSON.stringify(Array.from(e.results.entries()).sort());
  e.fullRecompute();
  const after = JSON.stringify(Array.from(e.results.entries()).sort());
  assert.strictEqual(before, after, '增量结果应与整体重推一致: ' + msg);
}

t('裁决后对象恢复可信并进入命中，增量与整体一致', () => {
  const e = fresh();
  const r = e.applyEvent({ type: 'adjudicate', objectId: 'obj-b', field: 'coord', value: { x: 35, y: 25 }, by: 'test' });
  assert.ok(r.affectedQueries.includes('Q1'));
  assert.strictEqual(e.resolutions.get('obj-b').trusted, true);
  assert.ok(hitIds(e, 'Q1').includes('obj-b'));
  assertConsistent(e, 'adjudicate');
});

t('撤回来源消除矛盾，增量与整体一致', () => {
  const e = fresh();
  e.applyEvent({ type: 'withdraw', objectId: 'obj-b', source: 'drone-1' });
  assert.strictEqual(e.resolutions.get('obj-b').trusted, true);
  assert.ok(hitIds(e, 'Q1').includes('obj-b'));
  assert.ok(e.resolutions.get('obj-b').withdrawnRecords.length === 1, '撤回记录保留留痕');
  assertConsistent(e, 'withdraw');
});

t('修正补充坐标使缺失对象可参与，增量与整体一致', () => {
  const e = fresh();
  e.applyEvent({ type: 'correct', record: { objectId: 'obj-c', source: 'fix-1', coord: { x: 32, y: 28 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31' } });
  const r = e.resolutions.get('obj-c');
  assert.strictEqual(r.fields.coord.status, 'partial-missing', '旧来源缺坐标应保留记录');
  assert.strictEqual(r.trusted, true);
  assert.ok(hitIds(e, 'Q1').includes('obj-c'));
  assertConsistent(e, 'correct');
});

t('调整查询范围只影响相关查询且与整体一致', () => {
  const e = fresh();
  const q2 = JSON.parse(JSON.stringify(e.queries.get('Q2')));
  q2.shape.minX = 10; // 扩大后与 Q1 大面积重叠
  const r = e.applyEvent({ type: 'updateQuery', query: q2 });
  assert.ok(r.affectedQueries.includes('Q2'));
  assert.ok(r.affectedQueries.includes('Q1'), '重叠关系变化应刷新 Q1 的歧义说明');
  assertConsistent(e, 'updateQuery');
});

t('类别过滤与有效期冲突：相关查询出现待裁决歧义提示', () => {
  const e = fresh();
  // obj-g 类别 vip/regular 矛盾，Q2 过滤 vip → 应出现归属待定歧义
  assert.ok(res(e, 'Q2').ambiguities.join('').includes('obj-g'));
});

console.log('passed:', n, 'tests');
