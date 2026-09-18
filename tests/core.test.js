/**
 * core.test.js — 领域内核不变量测试（node --test，零依赖）
 * 运行：node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('../js/retention-core.js');

function mkCohort(state, attr) {
  const r = RC.addCohort(state, attr);
  assert.ok(r.ok, r.message);
  return r.cohortId;
}

function obs(state, id, period, active, source) {
  return RC.addObservation(state, id, { period, active, source });
}

// ---------- 需求 1：维护 / 幂等 / 拒绝并指出位置 ----------

test('重复上报按幂等处理：同来源同期同值不产生第二条观测', () => {
  const s = RC.createState();
  const id = mkCohort(s, { name: '自然流量-1月', channel: '自然', stratum: '新客', size: 100, startAt: '2026-01-01' });
  assert.equal(obs(s, id, 0, 100, 'BI日报').status, 'added');
  assert.equal(obs(s, id, 0, 100, 'BI日报').status, 'duplicate');
  assert.equal(obs(s, id, 3, 80, 'BI日报').status, 'added');
  assert.equal(obs(s, id, 3, 80, 'BI日报').status, 'duplicate');
  assert.equal(RC.getCohort(s, id).obs.length, 2);
});

test('活跃数超规模：拒绝并指出队列、期、来源与数值', () => {
  const s = RC.createState();
  const id = mkCohort(s, { name: '付费-甲', channel: '付费', stratum: '新客', size: 50, startAt: '2026-01-01' });
  const r = obs(s, id, 2, 51, '渠道后台');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ACTIVE_OVER_SIZE');
  assert.match(r.message, /付费-甲/);
  assert.match(r.message, /第 2 期/);
  assert.equal(r.period, 2);
  assert.equal(r.active, 51);
  assert.equal(r.size, 50);
  // 被拒绝的数据没有入库
  assert.deepEqual(RC.observedPeriods(RC.getCohort(s, id)), []);
});

test('重复投递旧期数据按幂等处理，不被误判为时刻倒退', () => {
  const s = RC.createState();
  const id = mkCohort(s, { name: '长队列X', channel: 'x', stratum: '新客', size: 200, startAt: '2026-01-01' });
  for (let p = 0; p <= 6; p++) assert.ok(obs(s, id, p, 150 - p * 10, 'BI日报').ok);
  // 消息重投：第 0 期同来源同值
  assert.equal(obs(s, id, 0, 150, 'BI日报').status, 'duplicate');
});

test('迟到的另一来源对历史期给出矛盾值：仍按冲突双方保留（不是倒退）', () => {
  const s = RC.createState();
  const id = mkCohort(s, { name: '长队列Y', channel: 'y', stratum: '新客', size: 200, startAt: '2026-01-01' });
  obs(s, id, 0, 150, 'BI日报');
  for (let p = 1; p <= 4; p++) obs(s, id, p, 140 - p * 10, 'BI日报');
  const r = obs(s, id, 0, 120, '渠道回传'); // 历史期、不同来源、不同值
  assert.equal(r.status, 'conflict');
  assert.equal(RC.getCohort(s, id).conflicts[0].status, 'pending');
});

test('时刻倒退：拒绝给从未上报过的历史期补数据并指出位置', () => {
  const s = RC.createState();
  const id = mkCohort(s, { name: '社群-1月', channel: '社群', stratum: '老客', size: 200, startAt: '2026-01-01' });
  assert.ok(obs(s, id, 5, 120, 'BI日报').ok);
  const r = obs(s, id, 3, 130, '补录脚本');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TIME_REGRESSION');
  assert.equal(r.maxObservedPeriod, 5);
  assert.match(r.message, /第 3 期/);
  assert.match(r.message, /第 5 期/);
});

test('非法基础属性：空名称、坏规模、坏起始时刻均被拒绝', () => {
  const s = RC.createState();
  assert.equal(RC.addCohort(s, { name: '', channel: 'a', stratum: 'b', size: 10, startAt: '2026-01-01' }).ok, false);
  assert.equal(RC.addCohort(s, { name: 'x', channel: 'a', stratum: 'b', size: 0, startAt: '2026-01-01' }).ok, false);
  assert.equal(RC.addCohort(s, { name: 'x', channel: 'a', stratum: 'b', size: 10, startAt: 'not-a-date' }).ok, false);
  assert.equal(RC.addCohort(s, { name: 'x', channel: 'a', stratum: 'b', size: 10, startAt: '2026-01-01' }).ok, true);
});

// ---------- 需求 5：冲突双方保留，可读记录 ----------

test('同期矛盾值：双方均保留并生成可读冲突记录，绝不静默择一', () => {
  const s = RC.createState();
  const id = mkCohort(s, { name: '短视频-A', channel: '短视频', stratum: '新客', size: 100, startAt: '2026-01-01' });
  obs(s, id, 1, 70, 'BI日报');
  const conflict = obs(s, id, 1, 64, '渠道回传');
  assert.equal(conflict.status, 'conflict');
  const c = RC.getCohort(s, id);
  // 两条原始观测都在
  assert.deepEqual(c.obs.filter((o) => o.period === 1).map((o) => o.active).sort(), [64, 70]);
  const rec = c.conflicts[0];
  assert.equal(rec.status, 'pending');
  assert.equal(rec.period, 1);
  assert.deepEqual(rec.values.map((v) => v.source).sort(), ['BI日报', '渠道回传']);
  assert.deepEqual(rec.values.map((v) => v.active).sort(), [64, 70]);
  assert.match(conflict.message, /短视频-A/);
  assert.match(conflict.message, /BI日报/);
  assert.match(conflict.message, /64/);
  assert.match(conflict.message, /70/);
  // 有效值不可被擅自选定
  assert.equal(RC.effectiveActive(c, 1), null);
});

test('裁决冲突后：记录保留为 resolved，比较才纳入该期', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  const b = mkCohort(s, { name: 'B', channel: 'c2', stratum: '新客', size: 100, startAt: '2026-02-01' });
  obs(s, a, 0, 90, 'BI');
  obs(s, a, 1, 70, 'BI');
  obs(s, b, 0, 80, 'BI');
  obs(s, b, 1, 60, 'BI');
  obs(s, a, 1, 55, '渠道'); // 冲突
  let r = RC.compareCohorts(s, a, b);
  assert.deepEqual(r.window.periods, [0]); // 第 1 期被排除
  assert.ok(r.exclusions.some((e) => e.reasonCode === 'UNRESOLVED_CONFLICT' && e.period === 1));
  const key = RC.getCohort(s, a).conflicts[0].key;
  assert.ok(RC.resolveConflict(s, key, { active: 70, source: 'BI', reason: '以内部口径为准' }).ok);
  r = RC.compareCohorts(s, a, b);
  assert.deepEqual(r.window.periods, [0, 1]);
  assert.equal(RC.getCohort(s, a).conflicts[0].status, 'resolved');
});

// ---------- 需求 2：共同窗口，超出排除并说明，不做零/缺失填补 ----------

test('共同窗口：只比较双方都有有效观测的期，窗口外观测逐条排除并附原因', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: '长队列', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  const b = mkCohort(s, { name: '短队列', channel: 'c2', stratum: '新客', size: 80, startAt: '2026-02-01' });
  // A: 0..5；B: 1..3
  for (let p = 0; p <= 5; p++) obs(s, a, p, 90 - p * 10, 'BI');
  for (let p = 1; p <= 3; p++) obs(s, b, p, 70 - p * 5, 'BI');
  const r = RC.compareCohorts(s, a, b);
  assert.ok(r.ok);
  assert.deepEqual(r.window.periods, [1, 2, 3]);
  const excludedPeriods = r.exclusions.filter((e) => e.cohortId === a).map((e) => e.period).sort((x, y) => x - y);
  assert.deepEqual(excludedPeriods, [0, 4, 5]);
  assert.ok(r.exclusions.some((e) => e.period === 0 && e.reasonCode === 'BEFORE_WINDOW'));
  assert.ok(r.exclusions.some((e) => e.period === 5 && e.reasonCode === 'AFTER_WINDOW'));
  assert.match(r.exclusions.find((e) => e.period === 5).reason, /不得当作 0 或缺失/);
  // 关键：长队列尾部绝不被当成 0 留存拉低 —— rows 里没有第 4、5 期
  assert.deepEqual(r.rows.map((x) => x.period), [1, 2, 3]);
});

test('窗口跨度内的缺口不做零填补，按 GAP_IN_WINDOW 排除', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  const b = mkCohort(s, { name: 'B', channel: 'c2', stratum: '新客', size: 100, startAt: '2026-02-01' });
  obs(s, a, 0, 90, 'BI'); obs(s, a, 1, 80, 'BI'); obs(s, a, 2, 70, 'BI');
  obs(s, b, 0, 85, 'BI'); /* 缺第1期 */ obs(s, b, 2, 60, 'BI');
  const r = RC.compareCohorts(s, a, b);
  assert.deepEqual(r.window.periods, [0, 2]);
  assert.ok(r.exclusions.some((e) => e.period === 1 && e.cohortId === b && e.reasonCode === 'GAP_IN_WINDOW'));
  assert.equal(r.rows.length, 2);
});

test('无共同窗口时明确报错，绝不整体按零比较', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  const b = mkCohort(s, { name: 'B', channel: 'c2', stratum: '新客', size: 100, startAt: '2026-02-01' });
  obs(s, a, 0, 90, 'BI');
  obs(s, b, 3, 50, 'BI');
  const r = RC.compareCohorts(s, a, b);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_COMMON_WINDOW');
  assert.ok(r.exclusions.length >= 2);
});

// ---------- 需求 3：逐期解释 + 反转 + 可复现 ----------

test('逐期留存率、差额与方向正确', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  const b = mkCohort(s, { name: 'B', channel: 'c2', stratum: '新客', size: 200, startAt: '2026-02-01' });
  obs(s, a, 0, 80, 'BI'); obs(s, a, 1, 50, 'BI');
  obs(s, b, 0, 120, 'BI'); obs(s, b, 1, 140, 'BI');
  const r = RC.compareCohorts(s, a, b);
  assert.equal(r.rows[0].rateA, 0.8);
  assert.equal(r.rows[0].rateB, 0.6);
  assert.equal(r.rows[0].direction, 'A');
  assert.equal(r.rows[1].rateA, 0.5);
  assert.equal(r.rows[1].rateB, 0.7);
  assert.equal(r.rows[1].direction, 'B');
});

test('方向反转被检出并列出具体观察期', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  const b = mkCohort(s, { name: 'B', channel: 'c2', stratum: '新客', size: 100, startAt: '2026-02-01' });
  // A 领先 → B 领先（第2期反转）→ A 再次领先（第4期反转）
  const va = [90, 80, 40, 40, 60];
  const vb = [80, 70, 60, 60, 40];
  va.forEach((v, p) => obs(s, a, p, v, 'BI'));
  vb.forEach((v, p) => obs(s, b, p, v, 'BI'));
  const r = RC.compareCohorts(s, a, b);
  assert.equal(r.hasReversal, true);
  assert.deepEqual(r.reversals.map((x) => x.period), [2, 4]);
  assert.deepEqual(r.reversals[0], { period: 2, from: 'A', to: 'B' });
});

test('反转方向随 A/B 选择翻转而语义不变；重复比较完全一致', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  const b = mkCohort(s, { name: 'B', channel: 'c2', stratum: '新客', size: 100, startAt: '2026-02-01' });
  [90, 40].forEach((v, p) => obs(s, a, p, v, 'BI'));
  [80, 60].forEach((v, p) => obs(s, b, p, v, 'BI'));
  const r1 = RC.compareCohorts(s, a, b);
  const r2 = RC.compareCohorts(s, a, b);
  assert.strictEqual(r1, r2); // 缓存命中：完全同一结果
  const r3 = RC.compareCohorts(s, b, a);
  assert.equal(r1.rows[1].diff, -r3.rows[1].diff);
  assert.deepEqual(r1.reversals[0], { period: 1, from: 'A', to: 'B' });
  assert.deepEqual(r3.reversals[0], { period: 1, from: 'B', to: 'A' });
  // 序列化可复现（结果无时间戳噪声）
  assert.equal(JSON.stringify(r1.rows), JSON.stringify(RC.compareCohorts(s, a, b).rows));
});

// ---------- 需求 4：分层下限 ----------

test('分层可用队列不足下限时标为不可比并说明还缺多少', () => {
  const s = RC.createState({ minCohortsPerStratum: 2 });
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '孤层', size: 100, startAt: '2026-01-01' });
  obs(s, a, 0, 90, 'BI');
  const bId = mkCohort(s, { name: 'B', channel: 'c2', stratum: '双人层', size: 100, startAt: '2026-01-01' });
  const cId = mkCohort(s, { name: 'C', channel: 'c3', stratum: '双人层', size: 100, startAt: '2026-02-01' });
  obs(s, bId, 0, 80, 'BI');
  obs(s, cId, 0, 70, 'BI');
  const summary = RC.strataSummary(s);
  const lone = summary.find((x) => x.stratum === '孤层');
  const pair = summary.find((x) => x.stratum === '双人层');
  assert.equal(lone.comparable, false);
  assert.equal(lone.missing, 1);
  assert.match(lone.note, /还缺 1 个/);
  assert.match(lone.note, /不得与其他分层并列/);
  assert.equal(pair.comparable, true);
});

test('无观测的队列不计入分层可用数', () => {
  const s = RC.createState({ minCohortsPerStratum: 2 });
  const withData = mkCohort(s, { name: '有数据', channel: 'c1', stratum: '层X', size: 100, startAt: '2026-01-01' });
  mkCohort(s, { name: '空队列', channel: 'c2', stratum: '层X', size: 100, startAt: '2026-02-01' });
  obs(s, withData, 0, 90, 'BI');
  const x = RC.strataSummary(s).find((z) => z.stratum === '层X');
  assert.equal(x.count, 2);
  assert.equal(x.usableCount, 1);
  assert.equal(x.comparable, false);
});

test('跨分层比较会被标记 sameStratum=false，不输出分层优劣结论', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  const b = mkCohort(s, { name: 'B', channel: 'c2', stratum: '老客', size: 100, startAt: '2026-02-01' });
  obs(s, a, 0, 90, 'BI');
  obs(s, b, 0, 80, 'BI');
  assert.equal(RC.compareCohorts(s, a, b).sameStratum, false);
});

// ---------- 需求 6：增量更新 === 从头全量重算；未受影响结果保持不变 ----------

test('无关队列新增观测：其它比较结果保持同一对象引用；受影响比较与全量重算逐字段一致', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  const b = mkCohort(s, { name: 'B', channel: 'c2', stratum: '新客', size: 100, startAt: '2026-02-01' });
  const c = mkCohort(s, { name: 'C', channel: 'c3', stratum: '新客', size: 100, startAt: '2026-03-01' });
  for (let p = 0; p <= 3; p++) { obs(s, a, p, 90 - p * 5, 'BI'); obs(s, b, p, 80 - p * 5, 'BI'); obs(s, c, p, 70 - p * 5, 'BI'); }

  const abBefore = RC.compareCohorts(s, a, b);
  const acBefore = RC.compareCohorts(s, a, c);

  // 给 B 追加第 4 期（A 没有 → 窗口不扩大，但 A/B 结果签名变化；A/C 签名完全不变）
  obs(s, b, 4, 55, 'BI');

  const abAfter = RC.compareCohorts(s, a, b);
  const acAfter = RC.compareCohorts(s, a, c);
  assert.strictEqual(acAfter, acBefore, '未受影响的 A/C 比较必须保持同一结果对象');
  assert.notStrictEqual(abAfter, abBefore);

  // A/B 增量结果必须与在全新状态上全量重算完全一致
  const snapshot = JSON.parse(RC.serialize(s));
  const full = RC.fullRecompute(snapshot, a, b);
  assert.equal(JSON.stringify(strip(full)), JSON.stringify(strip(abAfter)));
  assert.ok(RC.deepEqual(strip(full), strip(abAfter)));
  // 新增的第 4 期作为 AFTER_WINDOW 出现在排除清单
  assert.ok(abAfter.exclusions.some((e) => e.cohortId === b && e.period === 4 && e.reasonCode === 'AFTER_WINDOW'));
});

test('规模修正后：留存率重算，且与全量重算一致；小于观测值的修正被拒绝', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  const b = mkCohort(s, { name: 'B', channel: 'c2', stratum: '新客', size: 100, startAt: '2026-02-01' });
  obs(s, a, 0, 80, 'BI');
  obs(s, b, 0, 80, 'BI');
  const before = RC.compareCohorts(s, a, b);
  assert.equal(before.rows[0].rateA, 0.8);

  const bad = RC.correctScale(s, a, 70);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'SCALE_BELOW_ACTIVE');
  assert.match(bad.locations[0], /第 0 期/);

  assert.ok(RC.correctScale(s, a, 160, '去重后规模修正').ok);
  const after = RC.compareCohorts(s, a, b);
  assert.equal(after.rows[0].rateA, 0.5);
  const full = RC.fullRecompute(JSON.parse(RC.serialize(s)), a, b);
  assert.ok(RC.deepEqual(strip(full), strip(after)));
});

test('持久化往返：序列化→重建后比较结果一致，冲突记录不丢', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  obs(s, a, 0, 90, 'BI');
  obs(s, a, 0, 80, '渠道');
  const json = RC.serialize(s);
  const { state: s2, errors } = RC.loadFromSnapshot(JSON.parse(json));
  assert.deepEqual(errors, []);
  assert.equal(s2.cohorts[0].conflicts.length, 1);
  assert.equal(s2.cohorts[0].conflicts[0].status, 'pending');
});

test('留存矩阵区分：未观测、正常、冲突、已裁决', () => {
  const s = RC.createState();
  const a = mkCohort(s, { name: 'A', channel: 'c1', stratum: '新客', size: 100, startAt: '2026-01-01' });
  obs(s, a, 0, 90, 'BI');
  obs(s, a, 1, 80, 'BI');
  obs(s, a, 1, 70, '渠道');
  const m = RC.retentionMatrix(s);
  assert.deepEqual(m.periods, [0, 1]);
  const cells = m.rows[0].cells;
  assert.equal(cells[0].state, 'observed');
  assert.equal(cells[0].rate, 0.9);
  assert.equal(cells[1].state, 'conflicted');
  assert.equal(cells[1].rate, null);
});

/** 结果中可能含循环/运行时字段，比较前只取可序列化视图 */
function strip(r) {
  return JSON.parse(JSON.stringify({
    ok: r.ok,
    code: r.code,
    idA: r.idA,
    idB: r.idB,
    sameStratum: r.sameStratum,
    window: r.window,
    rows: r.rows,
    exclusions: r.exclusions,
    reversals: r.reversals,
    hasReversal: r.hasReversal,
    summary: r.summary,
    message: r.message,
  }));
}
