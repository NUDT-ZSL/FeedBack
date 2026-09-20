const assert = require('assert');
const {
  parseDataset, aggregateRows, makeSnapshot, normalizeFilters,
  evaluateSnapshot, getNode, traceUpstream, dependencyState
} = require('../app.js');

const csv = '区域,客户类型,销售额\n' +
  '华东,新客,100\n华东,老客,200\n华北,新客,50\n华北,新客,70\n华南,老客,300\n';
const dataset = parseDataset(csv, '测试明细.csv');
const bomDataset = parseDataset(`\uFEFF${csv}`, 'Excel导出.csv');
assert.strictEqual(bomDataset.columns[0].name, '区域');
const quoted = parseDataset('地区,品类,销售额\n"华东,北",A,"1,200"\n华南,B,300\n', '带引号.csv');
assert.strictEqual(quoted.rows[0]['地区'], '华东,北');
assert.strictEqual(quoted.rows[0]['销售额'], 1200);
assert.strictEqual(aggregateRows(quoted, ['地区'], '销售额', 'sum', 1, [])
  .groups.find((group) => group.values[0] === '华东,北').value, 1200);

function config(overrides = {}) {
  return {
    dimensions: ['区域'],
    measure: '销售额',
    aggregation: 'sum',
    minSamples: 2,
    filters: [],
    ...overrides
  };
}

const base = config();
const result = aggregateRows(
  dataset, base.dimensions, base.measure, base.aggregation, base.minSamples, base.filters
);
assert.strictEqual(result.filteredCount, 5);
assert.strictEqual(result.groups.find((g) => g.values[0] === '华东').value, 300);
assert.strictEqual(result.groups.find((g) => g.values[0] === '华东').trusted, true);
assert.strictEqual(result.groups.find((g) => g.values[0] === '华南').trusted, false);

const east = result.groups.find((g) => g.values[0] === '华东');
const snapshot = makeSnapshot(dataset, base, result, east);
assert.deepStrictEqual(evaluateSnapshot(dataset, base, snapshot).valid, true);

const changedFilter = config({ filters: normalizeFilters(dataset, [
  { column: '区域', kind: 'dimension', op: 'in', values: ['华北'] }
]) });
const filterStatus = evaluateSnapshot(dataset, changedFilter, snapshot);
assert.strictEqual(filterStatus.valid, false);
assert.ok(filterStatus.reasons.some((reason) => reason.includes('筛选')));

const changedThreshold = config({ minSamples: 3 });
assert.ok(evaluateSnapshot(dataset, changedThreshold, snapshot).reasons.includes('可信度阈值已变化'));

const changedMeasure = config({ aggregation: 'avg' });
assert.ok(evaluateSnapshot(dataset, changedMeasure, snapshot).reasons.includes('度量口径已变化'));

const deleted = {
  id: 'f_deleted', title: '更早上游', note: '', references: [], snapshot,
  deletedAt: new Date().toISOString()
};
const child = { id: 'f_child', title: '引用被删除发现', note: '', references: ['f_deleted'], snapshot };
const broken = dependencyState([child], [deleted], 'f_child', new Map());
assert.strictEqual(broken.state, 'broken');
assert.ok(broken.warnings[0].includes('断链'));
assert.strictEqual(getNode([], [deleted], 'f_deleted').ghost, true);
assert.deepStrictEqual(traceUpstream([child], [deleted], 'f_child').map((node) => node.id), ['f_deleted']);

const upstream = { id: 'f_up', title: '已失效上游', note: '', references: [], snapshot };
const downstream = { id: 'f_down', title: '当前发现', note: '', references: ['f_up'], snapshot };
const validity = new Map([
  ['f_up', { valid: false, reasons: ['筛选范围或维度取值已变化'] }],
  ['f_down', { valid: true, reasons: [] }]
]);
assert.strictEqual(dependencyState([upstream, downstream], [], 'f_down', validity).state, 'risky');

const cycleA = { id: 'a', title: 'A', note: '', references: ['b'], snapshot };
const cycleB = { id: 'b', title: 'B', note: '', references: ['a'], snapshot };
assert.strictEqual(dependencyState([cycleA, cycleB], [], 'a', new Map()).state, 'cycle');

console.log('core tests passed');
