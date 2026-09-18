/*
 * test.js — 引擎测试（Node 运行：node test.js）
 * 逐条覆盖需求 1~7。
 */
'use strict';
const assert = require('assert');
const Engine = require('./engine.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✔ ' + name);
  } catch (e) {
    console.error('  ✘ ' + name);
    console.error('    ' + e.message);
    process.exitCode = 1;
  }
}

// 构造一个与界面示例一致的场景
function buildState() {
  const s = Engine.createState({ minCohortsPerStratum: 2 });
  Engine.addCohort(s, { id: 'A', name: '信息流·5月', stratum: '信息流', start: '2026-05', size: 1000 });
  Engine.addCohort(s, { id: 'B', name: '信息流·6月', stratum: '信息流', start: '2026-06', size: 1200 });
  Engine.addCohort(s, { id: 'C', name: '自然搜索·5月', stratum: '自然搜索', start: '2026-05', size: 800 });
  Engine.addCohort(s, { id: 'D', name: '线下·7月', stratum: '线下活动', start: '2026-07', size: 300 });
  [1000, 620, 510, 430, 380, 350].forEach((v, p) =>
    Engine.reportObservation(s, { cohortId: 'A', period: p, active: v, source: '数据平台' }));
  [1200, 700, 610, 540].forEach((v, p) =>
    Engine.reportObservation(s, { cohortId: 'B', period: p, active: v, source: '数据平台' }));
  [800, 520].forEach((v, p) =>
    Engine.reportObservation(s, { cohortId: 'C', period: p, active: v, source: '数据平台' }));
  [[3, 400], [4, 370]].forEach(([p, v]) =>
    Engine.reportObservation(s, { cohortId: 'C', period: p, active: v, source: '数据平台' }));
  [300, 150].forEach((v, p) =>
    Engine.reportObservation(s, { cohortId: 'D', period: p, active: v, source: '签到系统' }));
  return s;
}

console.log('需求 1：队列维护 / 幂等 / 拒绝');

test('重复上报幂等忽略，且不改变状态版本', () => {
  const s = buildState();
  const v0 = s.version, revA = s.cohorts.A.rev;
  const r = Engine.reportObservation(s, { cohortId: 'A', period: 3, active: 430, source: '数据平台' });
  assert.strictEqual(r.status, 'duplicate');
  assert.strictEqual(s.version, v0, 'version 不应变化');
  assert.strictEqual(s.cohorts.A.rev, revA, '队列修订号不应变化');
  assert.strictEqual(s.duplicates, 1);
});

test('重复创建相同队列幂等忽略', () => {
  const s = buildState();
  const r = Engine.addCohort(s, { id: 'A', name: '信息流·5月', stratum: '信息流', start: '2026-05', size: 1000 });
  assert.strictEqual(r.status, 'duplicate');
});

test('活跃数超规模被拒绝并指出位置', () => {
  const s = buildState();
  const r = Engine.reportObservation(s, { cohortId: 'A', period: 6, active: 1001, source: '数据平台' });
  assert.strictEqual(r.status, 'rejected');
  assert.ok(r.reason.includes('A') && r.reason.includes('第 6 期') && r.reason.includes('1001') && r.reason.includes('1000'),
    '拒绝原因应包含队列、期次、数值与规模: ' + r.reason);
  assert.strictEqual(s.cohorts.A.obs[6], undefined, '被拒绝的数据不得入库');
});

test('时刻倒退被拒绝并指出位置', () => {
  const s = buildState();
  Engine.reportObservation(s, { cohortId: 'A', period: 6, active: 300, source: '渠道后台', reportedAt: 100 });
  const r = Engine.reportObservation(s, { cohortId: 'A', period: 7, active: 280, source: '渠道后台', reportedAt: 50 });
  assert.strictEqual(r.status, 'rejected');
  assert.ok(r.reason.includes('时刻倒退') && r.reason.includes('渠道后台') && r.reason.includes('第 7 期'), r.reason);
});

test('负观察期（倒退到队列起始前）被拒绝', () => {
  const s = buildState();
  const r = Engine.reportObservation(s, { cohortId: 'A', period: -1, active: 100, source: '数据平台' });
  assert.strictEqual(r.status, 'rejected');
});

console.log('需求 2：共同观察窗口');

test('只在共同窗口内比较，窗口外观测排除并说明原因', () => {
  const s = buildState();
  const r = Engine.compareCohorts(s, 'A', 'B');
  assert.deepStrictEqual(r.window, [0, 1, 2, 3]);
  assert.deepStrictEqual(r.excludedA.map(e => e.period), [4, 5], 'A 的第 4、5 期应被排除');
  assert.strictEqual(r.excludedB.length, 0);
  assert.ok(r.excludedA[0].reason.includes('超出') && r.excludedA[0].reason.includes('第 3 期'), r.excludedA[0].reason);
  // 不得以零填补：排除期的活跃数绝不出现在结果行里
  assert.ok(r.rows.every(row => row.period <= 3));
});

test('无共同窗口时不可比较', () => {
  const s = Engine.createState();
  Engine.addCohort(s, { id: 'X', name: 'X', stratum: 'S', size: 100 });
  Engine.addCohort(s, { id: 'Y', name: 'Y', stratum: 'S', size: 100 });
  Engine.reportObservation(s, { cohortId: 'X', period: 0, active: 50, source: 'a' });
  Engine.reportObservation(s, { cohortId: 'Y', period: 3, active: 50, source: 'a' });
  const r = Engine.compareCohorts(s, 'X', 'Y');
  assert.strictEqual(r.window.length, 0);
  assert.strictEqual(r.excludedX, undefined); // 字段命名一致性检查
  assert.strictEqual(r.excludedA.length, 1);
  assert.strictEqual(r.excludedB.length, 1);
});

console.log('需求 3：差异可解释 / 方向反转 / 确定性');

test('逐期给出双方留存率与差额', () => {
  const s = buildState();
  const r = Engine.compareCohorts(s, 'A', 'B');
  const p1 = r.rows.find(row => row.period === 1);
  assert.ok(Math.abs(p1.rateA - 0.62) < 1e-12);
  assert.ok(Math.abs(p1.rateB - 700 / 1200) < 1e-12);
  assert.ok(Math.abs(p1.diff - (0.62 - 700 / 1200)) < 1e-12);
});

test('方向反转被检测并列出具体观察期', () => {
  const s = buildState();
  // A: p3 = 430/1000 = 43.0%；B: p3 = 540/1200 = 45.0% → 前期 A 领先，第 3 期反转为 B 领先
  const r = Engine.compareCohorts(s, 'A', 'B');
  assert.strictEqual(r.reversals.length, 1);
  assert.strictEqual(r.reversals[0].period, 3);
  assert.strictEqual(r.reversals[0].prevPeriod, 2);
  assert.strictEqual(r.reversals[0].from, 1);
  assert.strictEqual(r.reversals[0].to, -1);
});

test('重复比较结果完全一致（确定性）', () => {
  const s = buildState();
  const r1 = Engine.compareCohorts(s, 'A', 'B');
  const r2 = Engine.compareCohorts(s, 'A', 'B');
  const strip = o => JSON.parse(JSON.stringify(o, (k, v) => k === 'fromCache' ? undefined : v));
  assert.deepStrictEqual(strip(r1), strip(r2));
});

console.log('需求 4：分层可比下限');

test('队列数低于下限的分层标为不可比并说明缺口', () => {
  const s = buildState();
  const summary = Engine.stratumSummary(s);
  const offline = summary.find(x => x.stratum === '线下活动');
  assert.strictEqual(offline.comparable, false);
  assert.strictEqual(offline.missing, 1, '还差 1 个队列');
  const online = summary.find(x => x.stratum === '信息流');
  assert.strictEqual(online.comparable, true);
});

test('不可比分层不得与充足分层并列得出优劣结论', () => {
  const s = buildState();
  const r = Engine.compareStrata(s, '信息流', '线下活动');
  assert.strictEqual(r.comparable, false);
  assert.ok(r.reason.includes('线下活动') && r.reason.includes('还差 1'), r.reason);
});

test('两个充足分层可以比较', () => {
  const s = buildState();
  Engine.addCohort(s, { id: 'C2', name: '自然搜索·6月', stratum: '自然搜索', start: '2026-06', size: 900 });
  [900, 540, 470].forEach((v, p) => Engine.reportObservation(s, { cohortId: 'C2', period: p, active: v, source: '数据平台' }));
  const r = Engine.compareStrata(s, '信息流', '自然搜索');
  assert.strictEqual(r.comparable, true);
  assert.ok(r.window.length > 0);
});

console.log('需求 5：来源冲突');

test('矛盾数值双方保留并生成可读冲突记录', () => {
  const s = buildState();
  Engine.reportObservation(s, { cohortId: 'C', period: 2, active: 450, source: '数据平台' });
  const r = Engine.reportObservation(s, { cohortId: 'C', period: 2, active: 455, source: '渠道后台' });
  assert.strictEqual(r.status, 'conflict');
  assert.strictEqual(s.conflicts.length, 1);
  const c = s.conflicts[0];
  assert.strictEqual(c.cohortId, 'C');
  assert.strictEqual(c.period, 2);
  const vals = c.values.map(v => v.active).sort((a, b) => a - b);
  assert.deepStrictEqual(vals, [450, 455], '双方数值都必须保留');
  const sources = c.values.flatMap(v => v.sources);
  assert.ok(sources.includes('数据平台') && sources.includes('渠道后台'));
  // 不静默择一：该期解析值必须为 null（不可用）
  assert.strictEqual(Engine.resolvedValue(s.cohorts.C, 2), null);
});

test('冲突期不纳入比较，其余期不受影响', () => {
  const s = buildState();
  Engine.reportObservation(s, { cohortId: 'C', period: 2, active: 450, source: '数据平台' });
  Engine.reportObservation(s, { cohortId: 'C', period: 2, active: 455, source: '渠道后台' });
  Engine.addCohort(s, { id: 'C2', name: '自然搜索·6月', stratum: '自然搜索', start: '2026-06', size: 900 });
  [900, 540, 470].forEach((v, p) => Engine.reportObservation(s, { cohortId: 'C2', period: p, active: v, source: '数据平台' }));
  const r = Engine.compareCohorts(s, 'C', 'C2');
  assert.deepStrictEqual(r.window, [0, 1], '冲突的第 2 期不得进入共同窗口');
  assert.deepStrictEqual(r.conflictedA, [2]);
});

console.log('需求 6：增量更新一致性');

test('无关队列变化后，未受影响的比较返回同一结果对象（缓存命中）', () => {
  const s = buildState();
  const r1 = Engine.compareCohorts(s, 'A', 'B');
  Engine.reportObservation(s, { cohortId: 'D', period: 2, active: 100, source: '签到系统' }); // 改动无关队列
  const r2 = Engine.compareCohorts(s, 'A', 'B');
  assert.strictEqual(r2, r1, '未受影响的比较必须保持不变（同一对象）');
  assert.strictEqual(r2.fromCache, true);
});

test('受影响比较的重算与从头全量重算完全一致', () => {
  const s = buildState();
  Engine.compareCohorts(s, 'A', 'B'); // 建立缓存
  Engine.reportObservation(s, { cohortId: 'B', period: 4, active: 500, source: '数据平台' }); // 延长 B 的窗口
  const incremental = Engine.compareCohorts(s, 'A', 'B');
  assert.strictEqual(incremental.fromCache, false);
  assert.deepStrictEqual(incremental.window, [0, 1, 2, 3, 4], '窗口应扩展到第 4 期');

  // 从头全量重算：序列化 → 反序列化（等价于重放）→ 再比较
  const fresh = Engine.deserialize(Engine.serialize(s));
  const full = Engine.compareCohorts(fresh, 'A', 'B');
  const strip = o => JSON.parse(JSON.stringify(o, (k, v) => k === 'fromCache' ? undefined : v));
  assert.deepStrictEqual(strip(incremental), strip(full));
});

test('规模修正后受影响比较与全量重算一致；非法修正被拒绝', () => {
  const s = buildState();
  Engine.compareCohorts(s, 'A', 'B');
  const bad = Engine.correctSize(s, 'A', 300); // 小于已上报活跃 1000
  assert.strictEqual(bad.status, 'rejected');
  assert.ok(bad.reason.includes('第0期活跃 1000'), bad.reason);
  const ok = Engine.correctSize(s, 'A', 2000);
  assert.strictEqual(ok.status, 'accepted');
  const incremental = Engine.compareCohorts(s, 'A', 'B');
  assert.ok(Math.abs(incremental.rows[1].rateA - 620 / 2000) < 1e-12, '留存率应按新规模计算');
  const fresh = Engine.deserialize(Engine.serialize(s));
  const full = Engine.compareCohorts(fresh, 'A', 'B');
  const strip = o => JSON.parse(JSON.stringify(o, (k, v) => k === 'fromCache' ? undefined : v));
  assert.deepStrictEqual(strip(incremental), strip(full));
});

console.log('需求 7：界面数据完整性（矩阵/摘要结构）');

test('留存矩阵包含冲突标记与空位', () => {
  const s = buildState();
  Engine.reportObservation(s, { cohortId: 'C', period: 2, active: 450, source: '数据平台' });
  Engine.reportObservation(s, { cohortId: 'C', period: 2, active: 455, source: '渠道后台' });
  const m = Engine.retentionMatrix(s);
  assert.strictEqual(m.maxPeriod, 5);
  const rowC = m.rows.find(r => r.cohort.id === 'C');
  assert.strictEqual(rowC.cells[2].status, 'conflict');
  assert.strictEqual(rowC.cells[2].entries.length, 2, '冲突双方都要呈现在矩阵里');
  assert.strictEqual(rowC.cells[5].status, 'empty');
  const rowA = m.rows.find(r => r.cohort.id === 'A');
  assert.ok(Math.abs(rowA.cells[5].rate - 0.35) < 1e-12);
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '全部 ' + passed + ' 个用例通过'));
