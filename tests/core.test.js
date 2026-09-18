/* tests/core.test.js — 内核行为测试：node tests/core.test.js */
'use strict';
const assert = require('assert');
const FR = require('../core.js');
const { buildSampleModel } = require('../sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

function baseModel() {
  const m = FR.createModel();
  FR.registerMetric(m, { id: 'npv', name: 'NPV', unit: '万元', baseValue: 1200, threshold: 0, limit: 'min' });
  FR.registerAssumption(m, { id: 'a', name: 'A', unit: 'u', base: 5, min: 0, max: 10 }, 'S');
  FR.registerAssumption(m, { id: 'b', name: 'B', unit: 'u', base: 50, min: 0, max: 100 }, 'S');
  return m;
}

console.log('核心逻辑测试');

/* ---- 需求1：假设登记校验 ---- */
test('区间非法被拒绝并指出位置', () => {
  const m = FR.createModel();
  const r = FR.registerAssumption(m, { id: 'x', base: 5, min: 10, max: 0 }, 'S');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors[0].message.includes('区间非法'));
  assert.ok(r.errors[0].path.includes('x'));
});
test('基准越界被拒绝', () => {
  const m = FR.createModel();
  const r = FR.registerAssumption(m, { id: 'x', base: 99, min: 0, max: 10 }, 'S');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors[0].message.includes('基准值越界'));
});
test('同来源标识重复被拒绝，不同来源保留双方', () => {
  const m = baseModel();
  const dup = FR.registerAssumption(m, { id: 'a', base: 6, min: 0, max: 10 }, 'S');
  assert.strictEqual(dup.ok, false);
  assert.ok(dup.errors[0].message.includes('标识重复'));
  const other = FR.registerAssumption(m, { id: 'a', base: 6, min: 0, max: 10 }, 'S2');
  assert.strictEqual(other.ok, true);
  assert.strictEqual(Object.keys(m.assumptions.a.variants).length, 2);
});

/* ---- 需求2：响应段校验 ---- */
test('断点缺失（缺口）被拒绝并说明', () => {
  const m = baseModel();
  const r = FR.registerResponse(m, 'npv', 'a', [
    { x0: 0, y0: 0, x1: 4, y1: 4 }, { x0: 6, y0: 6, x1: 10, y1: 10 }], 'S');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.message.includes('断点缺失') && e.message.includes('(4, 6)')));
});
test('区间重叠被拒绝', () => {
  const m = baseModel();
  const r = FR.registerResponse(m, 'npv', 'a', [
    { x0: 0, y0: 0, x1: 6, y1: 6 }, { x0: 5, y0: 5, x1: 10, y1: 10 }], 'S');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.message.includes('重叠')));
});
test('段越界被拒绝', () => {
  const m = baseModel();
  const r = FR.registerResponse(m, 'npv', 'a', [
    { x0: 0, y0: 0, x1: 12, y1: 12 }], 'S');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.message.includes('越界')));
});
test('乱序登记合法段会被规范化并接受', () => {
  const m = baseModel();
  const r = FR.registerResponse(m, 'npv', 'a', [
    { x0: 5, y0: 5, x1: 10, y1: 10 }, { x0: 0, y0: 0, x1: 5, y1: 5 }], 'S');
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
});

/* ---- 需求3：贡献分解 ---- */
test('贡献之和等于总变化', () => {
  const m = baseModel();
  FR.registerResponse(m, 'npv', 'a', [{ x0: 0, y0: 100, x1: 10, y1: 300 }], 'S');
  FR.registerResponse(m, 'npv', 'b', [{ x0: 0, y0: 0, x1: 100, y1: 500 }], 'S');
  const dec = FR.computeDecomposition(m, 'npv', { a: 7, b: 20 });
  const sum = dec.contributions.reduce((s, c) => s + c.contribution, 0);
  assert.ok(Math.abs(sum - (dec.value - dec.baseValue)) < 1e-9);
  assert.ok(dec.sumCheck.ok);
  // a: f(7)-f(5)=240-200=40; b: f(20)-f(50)=100-250=-150; value=1200-110=1090
  assert.ok(Math.abs(dec.value - 1090) < 1e-9);
});

/* ---- 需求4：方向扫描首次越线 ---- */
test('首次越线位置与该处假设取值', () => {
  const m = baseModel();
  // a 从 5 起，权重 +1：f(a)=2200-400a → M(t)=1200-400t，t*=3 时 M=0，a=8（在界内）
  FR.registerResponse(m, 'npv', 'a', [{ x0: 0, y0: 2200, x1: 10, y1: -1800 }], 'S');
  FR.setDirection(m, 'a', 1);
  const sw = FR.sweepDirection(m, 'npv', FR.currentValues(m), m.direction);
  assert.ok(sw.firstCrossing && !sw.firstCrossing.touchedOnly, '应有首次越线');
  assert.ok(Math.abs(sw.firstCrossing.t - 3) < 1e-9, 't*=' + sw.firstCrossing.t);
  assert.ok(Math.abs(sw.firstCrossing.values.a - 8) < 1e-9, '越线处 a=' + sw.firstCrossing.values.a);
  assert.ok(Math.abs(sw.firstCrossing.metricValue - 0) < 1e-9);
  assert.ok(sw.firstCrossing.contributors.length >= 1);
});
test('触界限制：越线不可达时报告', () => {
  const m = baseModel();
  FR.registerResponse(m, 'npv', 'a', [{ x0: 0, y0: 2200, x1: 10, y1: 200 }], 'S');
  FR.setDirection(m, 'a', 1);
  const sw = FR.sweepDirection(m, 'npv', FR.currentValues(m), m.direction);
  assert.ok(Math.abs(sw.tHi - 5) < 1e-9);
  assert.ok(!sw.firstCrossing || sw.firstCrossing.touchedOnly);
  assert.ok(sw.unreachable && sw.unreachable.message.includes('不可达'));
});

/* ---- 需求5：非单调/平台/确定性 ---- */
test('非单调响应产生多个穿越点', () => {
  const m = FR.createModel();
  FR.registerMetric(m, { id: 'v', name: 'V', unit: '', baseValue: 0, threshold: 5, limit: 'max' });
  FR.registerAssumption(m, { id: 'a', base: 0, min: 0, max: 10 }, 'S');
  // M(a)：0→10 升到 10，再降回 0 → 两次穿越 y=5
  FR.registerResponse(m, 'v', 'a', [{ x0: 0, y0: 0, x1: 5, y1: 10 }, { x0: 5, y0: 10, x1: 10, y1: 0 }], 'S');
  FR.setDirection(m, 'a', 1);
  const sw = FR.sweepDirection(m, 'v', FR.currentValues(m), m.direction);
  const crosses = sw.crossings.filter(c => c.type === 'cross');
  assert.strictEqual(crosses.length, 2, JSON.stringify(sw.crossings));
  assert.ok(Math.abs(crosses[0].t - 2.5) < 1e-9 && Math.abs(crosses[1].t - 7.5) < 1e-9);
  assert.strictEqual(sw.violatedIntervals.length, 1);
});
test('平台产生平台区间而非单点', () => {
  const m = FR.createModel();
  FR.registerMetric(m, { id: 'v', name: 'V', unit: '', baseValue: 0, threshold: 5, limit: 'max' });
  FR.registerAssumption(m, { id: 'a', base: 0, min: 0, max: 10 }, 'S');
  FR.registerResponse(m, 'v', 'a', [{ x0: 0, y0: 0, x1: 4, y1: 5 }, { x0: 4, y0: 5, x1: 7, y1: 5 }, { x0: 7, y0: 5, x1: 10, y1: 9 }], 'S');
  FR.setDirection(m, 'a', 1);
  const sw = FR.sweepDirection(m, 'v', FR.currentValues(m), m.direction);
  assert.strictEqual(sw.plateauIntervals.length, 1);
  assert.ok(Math.abs(sw.plateauIntervals[0].t0 - 4) < 1e-9 && Math.abs(sw.plateauIntervals[0].t1 - 7) < 1e-9);
});
test('求解结果不随登记顺序变化', () => {
  const build = (order) => {
    const m = FR.createModel();
    FR.registerMetric(m, { id: 'v', name: 'V', unit: '', baseValue: 3, threshold: 5, limit: 'max' });
    const items = [
      ['c', { id: 'c', base: 0, min: -5, max: 5 }, [{ x0: -5, y0: 2, x1: 0, y1: 1 }, { x0: 0, y0: 1, x1: 5, y1: 8 }]],
      ['a', { id: 'a', base: 1, min: 0, max: 9 }, [{ x0: 0, y0: 0, x1: 4, y1: 6 }, { x0: 4, y0: 6, x1: 9, y1: 2 }]],
      ['b', { id: 'b', base: 2, min: 0, max: 4 }, [{ x0: 0, y0: 1, x1: 4, y1: 1 }]],
    ];
    for (const i of order) {
      const [, asm, segs] = items[i];
      FR.registerAssumption(m, asm, 'S');
      FR.registerResponse(m, 'v', asm.id, segs, 'S');
    }
    FR.setDirection(m, 'a', 1); FR.setDirection(m, 'b', -0.5); FR.setDirection(m, 'c', 2);
    return FR.sweepDirection(m, 'v', FR.currentValues(m), m.direction);
  };
  const r1 = build([0, 1, 2]), r2 = build([2, 0, 1]), r3 = build([1, 2, 0]);
  assert.strictEqual(JSON.stringify(r1), JSON.stringify(r2));
  assert.strictEqual(JSON.stringify(r1), JSON.stringify(r3));
});

/* ---- 需求6：冲突记录 ---- */
test('矛盾登记双方保留并生成可读冲突记录', () => {
  const m = FR.createModel();
  FR.registerAssumption(m, { id: 'cost', base: 60, min: 40, max: 90, unit: '元' }, '财务部');
  FR.registerAssumption(m, { id: 'cost', base: 63, min: 45, max: 88, unit: '元' }, '业务线');
  const conflicts = FR.getConflicts(m);
  assert.strictEqual(conflicts.length, 1);
  const c = conflicts[0];
  assert.strictEqual(c.assumptionId, 'cost');
  assert.strictEqual(c.entries.length, 2);
  assert.ok(c.message.includes('财务部') && c.message.includes('业务线'));
  assert.ok(c.message.includes('60') && c.message.includes('63'));
  // 双方内容均保留
  assert.ok(m.assumptions.cost.variants['财务部'] && m.assumptions.cost.variants['业务线']);
});

/* ---- 需求7：增量与全量一致，未受影响部分保持 ---- */
test('修改后未受影响指标缓存不变，受影响部分与全量一致', () => {
  const m = buildSampleModel(FR);
  FR.recompute(m, { all: true });
  const paybackCacheBefore = m._cache.payback.decomp; // rate 不作用于 payback
  FR.registerResponse(m, 'npv', 'rate', [
    { x0: 4, y0: 1700, x1: 8, y1: 1300 }, { x0: 8, y0: 1300, x1: 15, y1: 600 }], '评审修订', { replace: false });
  const status = FR.recompute(m, { assumptions: ['rate'] });
  assert.strictEqual(status.payback, 'unchanged');
  assert.strictEqual(m._cache.payback.decomp, paybackCacheBefore, '未受影响部分必须原样保留');
  const ver = FR.verifyConsistency(m);
  assert.ok(ver.ok, '受影响部分必须与全量一致：' + ver.diffs.join(';'));
});
test('拖动取值后增量结果与全量一致', () => {
  const m = buildSampleModel(FR);
  FR.recompute(m, { all: true });
  FR.setValue(m, 'price', 118);
  FR.setValue(m, 'cost', 74);
  FR.recompute(m, { assumptions: ['price', 'cost'] });
  const ver = FR.verifyConsistency(m);
  assert.ok(ver.ok, ver.diffs.join(';'));
});

/* ---- 需求8 支撑：示例模型开箱可用 ---- */
test('示例模型：默认方向下 NPV 有首次越线，贡献者齐全', () => {
  const m = buildSampleModel(FR);
  FR.recompute(m, { all: true });
  const sw = m._cache.npv.sweep;
  assert.ok(sw.firstCrossing && !sw.firstCrossing.touchedOnly, '默认方向应越线');
  assert.ok(sw.firstCrossing.contributors.length >= 2);
  assert.strictEqual(FR.getConflicts(m).length, 2, '示例应含 2 处冲突');
  assert.ok(FR.verifyConsistency(m).ok);
});

console.log(`\n${passed} 项通过${process.exitCode ? '（存在失败）' : ''}`);
