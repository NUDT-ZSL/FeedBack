// 引擎测试：node --test
// 覆盖需求 1~6 的核心行为：校验拒绝、确定性归并、推导守恒、
// 回填扣减、越界裁剪、冲突保留与消解。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REPORT_STATUS,
  validateStages,
  validateReport,
  analyzeReports,
  buildNetIntervals,
  coverageBetween,
  workAt,
  wallAt,
  derive,
  intervalSubtract,
  recompute,
  backfillReport,
} = require('../src/engine.js');

const STAGES = [
  { id: 's1', order: 1, name: '需求梳理', budgetMin: 45 },
  { id: 's2', order: 2, name: '编码实现', budgetMin: 90 },
  { id: 's3', order: 3, name: '自测验证', budgetMin: 60 },
  { id: 's4', order: 4, name: '文档整理', budgetMin: 30 },
  { id: 's5', order: 5, name: '复盘', budgetMin: 15 },
];
const SESSION = { startMin: 0, nowMin: 240 };

// ---------------------------------------------------------------------------
// 需求 1：阶段校验
// ---------------------------------------------------------------------------
test('阶段：预算时长非正被拒绝并指出位置', () => {
  const errors = validateStages([
    { id: 'a', order: 1, name: '甲', budgetMin: 30 },
    { id: 'b', order: 2, name: '乙', budgetMin: 0 },
    { id: 'c', order: 3, name: '丙', budgetMin: -10 },
  ]);
  assert.equal(errors.length, 2);
  assert.match(errors[0].reason, /第 2 个阶段/);
  assert.match(errors[0].reason, /必须为正数/);
  assert.match(errors[1].reason, /第 3 个阶段/);
});

test('阶段：顺序重复被拒绝并指出双方位置', () => {
  const errors = validateStages([
    { id: 'a', order: 2, name: '甲', budgetMin: 30 },
    { id: 'b', order: 1, name: '乙', budgetMin: 30 },
    { id: 'c', order: 2, name: '丙', budgetMin: 30 },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /第 3 个阶段/);
  assert.match(errors[0].reason, /第 1 个阶段/);
  assert.match(errors[0].reason, /顺序重复/);
});

test('阶段：合法设置通过校验', () => {
  assert.deepEqual(validateStages(STAGES), []);
});

// ---------------------------------------------------------------------------
// 需求 2：报告校验与净区间归并
// ---------------------------------------------------------------------------
test('报告：零长与起止颠倒被拒绝', () => {
  assert.match(validateReport({ id: 'i', source: 's', start: 10, end: 10, status: 'active' }), /零长/);
  assert.match(validateReport({ id: 'i', source: 's', start: 20, end: 10, status: 'active' }), /颠倒/);
  assert.match(validateReport({ id: 'i', source: '', start: 1, end: 2, status: 'active' }), /缺少来源/);
  assert.equal(validateReport({ id: 'i', source: 's', start: 1, end: 2, status: 'active' }), null);
});

test('净区间：重叠与相接区间确定性归并', () => {
  const effective = [
    { id: 'a', source: 'x', start: 10, end: 20, status: 'active' },
    { id: 'b', source: 'y', start: 15, end: 30, status: 'active' },
    { id: 'c', source: 'z', start: 30, end: 40, status: 'active' }, // 相接也合并
    { id: 'd', source: 'w', start: 50, end: 60, status: 'active' },
    { id: 'e', source: 'v', start: 70, end: 80, status: 'resolved' }, // 已消解不计
  ];
  const { net } = buildNetIntervals(effective, 0, 100);
  assert.deepEqual(
    net.map((iv) => [iv.start, iv.end]),
    [
      [10, 40],
      [50, 60],
    ],
  );
  // 归并结果互不重叠
  for (let i = 1; i < net.length; i++) assert.ok(net[i].start > net[i - 1].end);
  // 来源可追溯
  assert.deepEqual(net[0].refs.map((r) => r.id), ['a', 'b', 'c']);
});

test('净区间：输入顺序不影响归并结果（确定性）', () => {
  const effective = [
    { id: 'a', source: 'x', start: 10, end: 20, status: 'active' },
    { id: 'b', source: 'y', start: 15, end: 30, status: 'active' },
    { id: 'c', source: 'z', start: 50, end: 60, status: 'active' },
  ];
  const shuffled = [effective[2], effective[0], effective[1]];
  const strip = (net) => net.map(({ start, end }) => ({ start, end }));
  assert.deepEqual(strip(buildNetIntervals(effective, 0, 100).net), strip(buildNetIntervals(shuffled, 0, 100).net));
});

// ---------------------------------------------------------------------------
// 需求 3：推导、恢复位置、守恒、确定性
// ---------------------------------------------------------------------------
test('推导：计入/剩余/恢复位置正确且守恒', () => {
  // 净打断 [20,35) 与 [70,100)，总工作时长 = 240 - 45 = 195
  const net = [
    { start: 20, end: 35, refs: [] },
    { start: 70, end: 100, refs: [] },
  ];
  const d = derive(SESSION, STAGES, net);
  assert.equal(d.totalWorkMin, 195);
  assert.deepEqual(
    d.rows.map((r) => r.countedMin),
    [45, 90, 60, 0, 0],
  );
  assert.deepEqual(
    d.rows.map((r) => r.remainingMin),
    [0, 0, 0, 30, 15],
  );
  assert.deepEqual(
    d.rows.map((r) => r.status),
    ['done', 'done', 'done', 'pending', 'pending'],
  );
  assert.equal(d.resume.stageId, 's4');
  assert.equal(d.resume.offsetMin, 0);
  assert.equal(d.resume.remainingMin, 30);
  assert.ok(d.conservationOk);
  // 全局守恒：计入 + 剩余 = 预算；工作时长 + 净打断 = 墙钟
  const sumCounted = d.rows.reduce((s, r) => s + r.countedMin, 0);
  const sumRemaining = d.rows.reduce((s, r) => s + r.remainingMin, 0);
  assert.equal(sumCounted + sumRemaining, d.totalBudgetMin);
  assert.equal(d.totalWorkMin + coverageBetween(net, 0, 240), 240);
});

test('推导：同一批记录重复推导结果完全一致', () => {
  const reports = [
    { uid: 'r1', id: 'i1', source: 'A', start: 20, end: 35, status: 'active' },
    { uid: 'r2', id: 'i2', source: 'B', start: 70, end: 90, status: 'active' },
    { uid: 'r3', id: 'i3', source: 'C', start: 85, end: 100, status: 'active' },
    { uid: 'r4', id: 'i4', source: 'D', start: 200, end: 210, status: 'resolved' },
  ];
  const r1 = recompute(SESSION, STAGES, reports);
  const r2 = recompute(SESSION, STAGES, reports);
  assert.equal(JSON.stringify(r1.derivation), JSON.stringify(r2.derivation));
  assert.equal(JSON.stringify(r1.net), JSON.stringify(r2.net));
  // 打乱报告顺序，推导结果与净区间仍一致
  const r3 = recompute(SESSION, STAGES, [...reports].reverse());
  assert.equal(JSON.stringify(r1.derivation), JSON.stringify(r3.derivation));
  assert.equal(
    JSON.stringify(r1.net.map(({ start, end }) => ({ start, end }))),
    JSON.stringify(r3.net.map(({ start, end }) => ({ start, end }))),
  );
});

test('工作钟换算：wallAt 与 workAt 在净区间外互逆', () => {
  const net = [
    { start: 20, end: 35, refs: [] },
    { start: 70, end: 100, refs: [] },
  ];
  assert.equal(workAt(net, 0, 150), 105);
  assert.equal(wallAt(net, 0, 105), 150);
  assert.equal(wallAt(net, 0, 0), 0);
});

// ---------------------------------------------------------------------------
// 需求 4：事后补报 —— 回填、重推、越界裁剪、未受影响阶段不变
// ---------------------------------------------------------------------------
test('补报：回填后重推受影响阶段，未受影响阶段不变', () => {
  const session = { startMin: 0, nowMin: 120 };
  const stages = [
    { id: 's1', order: 1, name: '一', budgetMin: 45 },
    { id: 's2', order: 2, name: '二', budgetMin: 90 },
    { id: 's3', order: 3, name: '三', budgetMin: 60 },
  ];
  const outcome = backfillReport(session, stages, [], {
    uid: 'r1',
    id: 'x',
    source: '手动记录',
    start: 30,
    end: 50,
    status: 'active',
  });
  assert.ok(outcome.ok);
  // 总工作时长 120 → 100；扣减发生在 frontier 阶段 s2
  assert.equal(outcome.after.derivation.totalWorkMin, 100);
  assert.deepEqual(
    outcome.after.derivation.rows.map((r) => r.countedMin),
    [45, 55, 0],
  );
  assert.deepEqual(outcome.diff.deductions, [{ stageId: 's2', name: '二', order: 2, amountMin: 20 }]);
  // 扣减总量 = 净打断新增覆盖量
  const added = outcome.newNetParts.reduce((s, p) => s + (p.end - p.start), 0);
  const deducted = outcome.diff.deductions.reduce((s, d) => s + d.amountMin, 0);
  assert.equal(added, 20);
  assert.equal(deducted, added);
  // 守恒依然成立
  assert.ok(outcome.after.derivation.conservationOk);
});

test('补报：越界部分被裁掉并说明', () => {
  const outcome = backfillReport(SESSION, STAGES, [], {
    uid: 'r1',
    id: 'far',
    source: '手动记录',
    start: 230,
    end: 300,
    status: 'active',
  });
  assert.ok(outcome.ok);
  assert.deepEqual(
    outcome.after.net.map((iv) => [iv.start, iv.end]),
    [[230, 240]],
  );
  assert.equal(outcome.after.clipNotes.length, 1);
  assert.match(outcome.after.clipNotes[0].message, /越界部分已裁掉/);
  assert.match(outcome.after.clipNotes[0].message, /\[230, 240\)/);
});

test('补报：完全越界的报告整体裁掉', () => {
  const outcome = backfillReport(SESSION, STAGES, [], {
    uid: 'r1',
    id: 'far',
    source: '手动记录',
    start: 300,
    end: 320,
    status: 'active',
  });
  assert.ok(outcome.ok);
  assert.equal(outcome.after.net.length, 0);
  assert.match(outcome.after.clipNotes[0].message, /整体裁掉/);
});

test('补报：零长与颠倒区间被拒绝且不产生任何变化', () => {
  const bad1 = backfillReport(SESSION, STAGES, [], { uid: 'r1', id: 'x', source: 's', start: 10, end: 10, status: 'active' });
  const bad2 = backfillReport(SESSION, STAGES, [], { uid: 'r2', id: 'x', source: 's', start: 50, end: 40, status: 'active' });
  assert.equal(bad1.ok, false);
  assert.match(bad1.reason, /零长/);
  assert.equal(bad2.ok, false);
  assert.match(bad2.reason, /颠倒/);
});

// ---------------------------------------------------------------------------
// 需求 5：净区间与已计入片段交叠 → 扣减且不计两次
// ---------------------------------------------------------------------------
test('扣减：同一时刻不被计两次，扣减来源可追溯', () => {
  const session = { startMin: 0, nowMin: 100 };
  const stages = [
    { id: 's1', order: 1, name: '一', budgetMin: 50 },
    { id: 's2', order: 2, name: '二', budgetMin: 50 },
  ];
  // 先有一段打断 [10,20)，再补报 [15,25)：净区间 [10,25)，新增部分仅 [20,25)
  const existing = [{ uid: 'r0', id: 'a', source: '监控', start: 10, end: 20, status: 'active' }];
  const outcome = backfillReport(session, stages, existing, {
    uid: 'r1',
    id: 'b',
    source: '手动',
    start: 15,
    end: 25,
    status: 'active',
  });
  assert.ok(outcome.ok);
  assert.deepEqual(
    outcome.after.net.map((iv) => [iv.start, iv.end]),
    [[10, 25]],
  );
  assert.deepEqual(
    outcome.newNetParts.map((p) => [p.start, p.end]),
    [[20, 25]],
  );
  // 只扣减新增的 5 分钟，不会把重叠的 [15,20) 再扣一次
  const deducted = outcome.diff.deductions.reduce((s, d) => s + d.amountMin, 0);
  assert.equal(deducted, 5);
  assert.equal(outcome.after.derivation.totalWorkMin, 85);
  assert.ok(outcome.after.derivation.conservationOk);
});

// ---------------------------------------------------------------------------
// 需求 6：冲突保留双方、可读记录、不静默择一
// ---------------------------------------------------------------------------
test('冲突：矛盾区间双方保留并生成可读记录，且不纳入推导', () => {
  const reports = [
    { uid: 'r1', id: 'i1', source: '应用监控', start: 150, end: 170, status: 'active' },
    { uid: 'r2', id: 'i1', source: '日历同步', start: 155, end: 165, status: 'resolved' },
  ];
  const { groups } = analyzeReports(reports);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.ok(g.conflict);
  assert.equal(g.effective, null);
  assert.equal(g.reports.length, 2); // 双方均保留
  assert.match(g.conflict.message, /i1/);
  assert.match(g.conflict.message, /应用监控/);
  assert.match(g.conflict.message, /日历同步/);
  assert.match(g.conflict.message, /\[150, 170\)/);
  assert.match(g.conflict.message, /\[155, 165\)/);
  // 不静默择一：该打断不进入净区间
  const result = recompute(SESSION, STAGES, reports);
  assert.equal(result.net.length, 0);
  assert.equal(result.conflicts.length, 1);
});

test('冲突：多来源报告一致则合并来源，不算冲突', () => {
  const reports = [
    { uid: 'r1', id: 'i1', source: 'A', start: 10, end: 20, status: 'active' },
    { uid: 'r2', id: 'i1', source: 'B', start: 10, end: 20, status: 'active' },
  ];
  const { groups } = analyzeReports(reports);
  assert.equal(groups[0].conflict, null);
  assert.equal(groups[0].effective.source, 'A、B');
});

test('冲突：人工采纳一方后以采纳方为准，另一方保留', () => {
  const reports = [
    { uid: 'r1', id: 'i1', source: 'A', start: 150, end: 170, status: 'active' },
    { uid: 'r2', id: 'i1', source: 'B', start: 155, end: 165, status: 'resolved' },
  ];
  // 用户采纳来源 A
  reports[0].adopted = true;
  const result = recompute(SESSION, STAGES, reports);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(
    result.net.map((iv) => [iv.start, iv.end]),
    [[150, 170]],
  );
  const g = result.groups[0];
  assert.ok(g.hadConflict);
  assert.equal(g.reports.length, 2); // 未采纳方仍保留
});

// ---------------------------------------------------------------------------
// 区间差集
// ---------------------------------------------------------------------------
test('intervalSubtract：返回未被覆盖的部分', () => {
  const base = [
    { start: 0, end: 10 },
    { start: 20, end: 30 },
  ];
  const cut = [{ start: 5, end: 25 }];
  assert.deepEqual(
    intervalSubtract(base, cut).map((p) => [p.start, p.end]),
    [
      [0, 5],
      [25, 30],
    ],
  );
});
