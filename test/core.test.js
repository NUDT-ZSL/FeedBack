const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSession, makeStage, makeInterruption, makeSourceRecord,
  validateStages, validateInterruptions,
  buildNetIntervals, detectConflicts, computeSchedule, derive,
  addSourceReport, resolveSource, diffSchedules,
  STAGE_STATUS, RESOLUTION,
} = require('../src/core.js');

const stage = (order, budget, name, status = STAGE_STATUS.PENDING) =>
  makeStage({ id: `s${order}`, name: name || `阶段${order}`, budgetMinutes: budget, order, status });

const src = (source, start, end, resolution = RESOLUTION.PENDING, id) =>
  makeSourceRecord({ id: id || `${source}-${start}-${end}`, source, start, end, resolution });

const intt = (id, reason, sources) => makeInterruption({ id, reason, sources });

function near(actual, expected, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);
}

// ---------- 需求1：阶段维护与校验 ----------

test('1. 预算非正被拒绝并指出位置', () => {
  const r = validateStages([stage(1, 25), stage(2, 0), stage(3, -10)]);
  assert.equal(r.ok, false);
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes('BAD_BUDGET'));
  const bad = r.errors.find((e) => e.code === 'BAD_BUDGET' && e.order === 2);
  assert.ok(bad, '应定位到 order=2');
  assert.match(bad.message, /第 2 行/);
  assert.match(bad.at, /index=1/);
});

test('2. 顺序重复被拒绝并指出位置', () => {
  const r = validateStages([stage(1, 25), stage(2, 30), stage(2, 20)]);
  assert.equal(r.ok, false);
  const dup = r.errors.find((e) => e.code === 'DUP_ORDER');
  assert.ok(dup);
  assert.equal(dup.order, 2);
  assert.match(dup.message, /顺序重复/);
});

test('3. 正常阶段通过校验且按序排布', () => {
  const s = createSession({ stages: [stage(2, 30, '写作'), stage(1, 25, '阅读')] });
  const d = derive(s);
  assert.equal(d.ok, true);
  const [a, b] = d.schedule.stages;
  assert.equal(a.order, 1);
  assert.equal(a.name, '阅读');
  near(a.windowStart, 0);
  near(a.windowEnd, 25);
  near(b.windowStart, 25);
  near(b.windowEnd, 55);
});

// ---------- 需求2：打断校验与确定性合并 ----------

test('4. 零长 / 起止颠倒 / 负起点被拒绝', () => {
  const cases = [
    [src('日历', 10, 10), 'ZERO_LEN'],
    [src('日历', 20, 10), 'REVERSED'],
    [src('日历', -5, 10), 'NEG_START'],
  ];
  for (const [record, code] of cases) {
    const r = validateInterruptions([intt('i', '来电', [record])]);
    assert.equal(r.ok, false, `${code} 应被拒绝`);
    assert.ok(r.errors.some((e) => e.code === code), `缺少 ${code}`);
    const e = r.errors[0];
    assert.ok(e.interruptionId === 'i');
    assert.match(e.message, /日历/);
  }
});

test('5. 重叠/相接区间按确定性规则归并为净打断', () => {
  const i1 = intt('i1', '来电', [src('日历', 10, 20, RESOLUTION.CONFIRMED)]);
  const i2 = intt('i2', '同事', [src('即时消息', 15, 25, RESOLUTION.CONFIRMED)]);
  const i3 = intt('i3', '停水', [src('物业', 40, 45, RESOLUTION.CONFIRMED)]);
  const i4 = intt('i4', '通知', [src('系统', 25, 30, RESOLUTION.CONFIRMED)]); // 与 i1/i2 首尾相接
  const net = buildNetIntervals([i4, i2, i3, i1]); // 故意乱序输入
  assert.equal(net.length, 2);
  near(net[0].start, 10);
  near(net[0].end, 30);
  near(net[0].duration, 20);
  assert.equal(net[0].members.length, 3);
  near(net[1].start, 40);
  near(net[1].end, 45);
});

test('6. 待消解/已否决的记录不进入净打断', () => {
  const it = intt('i1', '来电', [
    src('日历', 10, 20, RESOLUTION.PENDING),
    src('主管', 12, 18, RESOLUTION.DISMISSED),
  ]);
  assert.equal(buildNetIntervals([it]).length, 0);
});

// ---------- 需求3：计入/剩余/恢复位置 + 确定性 ----------

test('7. 由净打断推出计入、剩余与恢复位置', () => {
  // 阶段1 预算50（标记 done），t=10..20 有确认打断 → 实际窗 [0,60]
  const session = createSession({
    stages: [stage(1, 50, '设计', STAGE_STATUS.DONE), stage(2, 40, '实现'), stage(3, 30, '复盘')],
    interruptions: [intt('i1', '来电', [src('日历', 10, 20, RESOLUTION.CONFIRMED)])],
  });
  const d = derive(session);
  const [s1, s2, s3] = d.schedule.stages;
  near(s1.windowStart, 0);
  near(s1.windowEnd, 60);      // 50 预算 + 10 打断
  near(s1.countedMinutes, 50);
  near(s1.remainingMinutes, 0);
  near(s2.windowStart, 60);
  near(s2.windowEnd, 100);
  near(s2.countedMinutes, 0);  // 未开始
  near(s2.remainingMinutes, 40);
  const r = d.schedule.resume;
  assert.equal(r.completed, false);
  assert.equal(r.stageId, 's2');
  near(r.offsetMinutes, 0);
  near(r.remainingMinutes, 40);
});

test('8. nowMinutes 推进后 active 阶段计入 = 前沿前工作片段，守恒成立', () => {
  // 阶段预算 60，净打断 [10,20] 与 [40,50]，占用窗 [0,80]
  // now=30：[0,10]=10 工作，[10,20]=打断，[20,30]=10 工作 → counted=20
  const session = createSession({
    nowMinutes: 30,
    stages: [stage(1, 60, '深度工作', STAGE_STATUS.ACTIVE)],
    interruptions: [
      intt('i1', '来电', [src('日历', 10, 20, RESOLUTION.CONFIRMED)]),
      intt('i2', '提问', [src('同事', 40, 50, RESOLUTION.CONFIRMED)]),
    ],
  });
  const d = derive(session);
  const s = d.schedule.stages[0];
  near(s.countedMinutes, 20);
  near(s.remainingMinutes, 40);
  near(s.windowEnd, 80);
  assert.ok(diffSchedules(emptyAudit(s), d.schedule).conservation.every((c) => c.ok));
  // 恢复位置
  assert.equal(d.schedule.resume.stageId, 's1');
  near(d.schedule.resume.offsetMinutes, 20);
});

function emptyAudit() {
  return { stages: [], resume: null, sessionEnd: 0 };
}

test('9. 同一批记录重复推导结果完全一致（含乱序输入）', () => {
  const build = () => createSession({
    nowMinutes: 42,
    stages: [stage(3, 30, 'C'), stage(1, 50, 'A', STAGE_STATUS.DONE), stage(2, 40, 'B')],
    interruptions: [
      intt('i2', '提问', [src('同事', 65, 70, RESOLUTION.CONFIRMED)]),
      intt('i1', '来电', [src('日历', 10, 20, RESOLUTION.CONFIRMED), src('主管', 12, 25, RESOLUTION.CONFIRMED)]),
    ],
  });
  const d1 = derive(build());
  const d2 = derive(build());
  assert.deepEqual(JSON.parse(JSON.stringify(d2)), JSON.parse(JSON.stringify(d1)));
  // 净区间成员顺序也确定
  assert.deepEqual(d1.netIntervals.map((n) => [n.start, n.end]), [[10, 25], [65, 70]]);
  // active 阶段（B，order=2）counted：now=42 落在 A 窗 [0,60] 内 → B 尚未开始为 0
  near(d1.schedule.stages[1].countedMinutes, 0);
});

// ---------- 需求4：事后补报、回填重推、越界裁剪 ----------

test('10. 补报已确认打断后重推受影响阶段及后续起点，未受影响阶段不变', () => {
  // 初始：两个预算 50 的阶段，无打断。now=100 → 第一阶段已完成计入，第二阶段进行中 counted=50?
  // 设定：s1 done；now=70 → s2 窗 [50,100] 内 [50,70] 工作计入 20
  let session = createSession({
    nowMinutes: 70,
    stages: [stage(1, 50, '设计', STAGE_STATUS.DONE), stage(2, 50, '实现', STAGE_STATUS.ACTIVE)],
    interruptions: [],
  });
  const before = derive(session).schedule;
  near(before.stages[0].windowEnd, 50);
  near(before.stages[1].countedMinutes, 20);

  // 事后补报：t=10..20（在 s1 窗内）已确认
  const rep = addSourceReport(session, { interruptionId: 'ix', reason: '紧急来电', source: '日历', start: 10, end: 20, resolution: RESOLUTION.CONFIRMED });
  assert.equal(rep.ok, true);
  session = rep.session;
  const after = derive(session).schedule;
  const audit = diffSchedules(before, after);

  // s1 占用窗 [0,50]→[0,60]；s2 起点 50→60
  near(after.stages[0].windowEnd, 60);
  near(after.stages[1].windowStart, 60);
  assert.deepEqual(audit.unchangedStages, []);
  // 前沿仍为挂钟 70：s2 窗 [60,110]，[60,70] 工作 = 10（少计的 10 分钟是因为 s1 被打断推迟）
  near(after.stages[1].countedMinutes, 10);
});

test('11. 越界补报被裁剪并给出说明，裁剪为空则拒绝写入', () => {
  const session = createSession({
    nowMinutes: 30,
    stages: [stage(1, 50, '设计', STAGE_STATUS.DONE)],
    interruptions: [],
  });
  // 末端 = done 阶段窗末端 50。补报 [40,70] → 裁到 [40,50]
  const rep = addSourceReport(session, { interruptionId: 'i', reason: '来电', source: '日历', start: 40, end: 70, resolution: RESOLUTION.CONFIRMED });
  assert.equal(rep.ok, true);
  assert.equal(rep.truncations.length, 1);
  assert.equal(rep.truncations[0].kind, 'past-end');
  near(rep.truncations[0].droppedMinutes, 20);
  const written = rep.session.interruptions[0].sources[0];
  near(written.start, 40);
  near(written.end, 50);

  // 负起点补报 [-5,10] → 裁到 [0,10]
  const rep2 = addSourceReport(session, { interruptionId: 'i2', reason: '早于会话', source: '系统', start: -5, end: 10, resolution: RESOLUTION.PENDING });
  assert.equal(rep2.ok, true);
  near(rep2.truncations[0].clipped.start, 0);

  // 完全越界 [60,70] → 裁剪为空，拒绝写入
  const rep3 = addSourceReport(session, { interruptionId: 'i3', reason: '未来', source: '系统', start: 60, end: 70, resolution: RESOLUTION.PENDING });
  assert.equal(rep3.ok, false);
  assert.ok(rep3.errors.some((e) => e.code === 'CLIPPED_AWAY'));
  assert.equal(session.interruptions.length, 0);
});

test('12. 补报非法区间直接拒绝，会话不变', () => {
  const session = createSession({ stages: [stage(1, 50)], interruptions: [] });
  const rep = addSourceReport(session, { interruptionId: 'i', reason: 'x', source: '日历', start: 30, end: 30, resolution: RESOLUTION.PENDING });
  assert.equal(rep.ok, false);
  assert.ok(rep.errors.some((e) => e.code === 'ZERO_LEN'));
  assert.equal(rep.session.interruptions.length, 0);
});

// ---------- 需求5：双重计扣减与守恒 ----------

test('13. 回填打断与已计入片段交叠时扣减重复计入并给出来源台账', () => {
  // s1 预算50，无打断时窗 [0,50]，now=40 → counted=40，已计入片段 [0,40]
  let session = createSession({ nowMinutes: 40, stages: [stage(1, 50, '设计', STAGE_STATUS.ACTIVE)], interruptions: [] });
  const before = derive(session).schedule;
  near(before.stages[0].countedMinutes, 40);

  // 补报确认打断 [20,30]（完全落在已计入片段 [0,40] 内）
  const rep = addSourceReport(session, { interruptionId: 'ir', reason: '紧急来电', source: '日历', start: 20, end: 30, resolution: RESOLUTION.CONFIRMED });
  session = rep.session;
  const after = derive(session).schedule;
  const audit = diffSchedules(before, after);

  // 占用窗变为 [0,60]；前沿 40 内的工作片段 [0,20]+[30,40] = 30
  near(after.stages[0].countedMinutes, 30);
  near(after.stages[0].remainingMinutes, 20);
  assert.equal(audit.doubleCountDeductions.length, 1);
  const dd = audit.doubleCountDeductions[0];
  near(dd.duration, 10);
  near(dd.overlap.start, 20);
  near(dd.overlap.end, 30);
  assert.equal(dd.sources[0].source, '日历');
  assert.equal(dd.sources[0].interruptionId, 'ir');
  assert.match(dd.message, /紧急来电|日历/);
  assert.ok(audit.conservationOk, '计入+剩余必须等于预算');
});

test('14. 补报位于前沿之后的打断不产生双重计扣减', () => {
  let session = createSession({ nowMinutes: 20, stages: [stage(1, 50, '设计', STAGE_STATUS.ACTIVE)], interruptions: [] });
  const before = derive(session).schedule;
  const rep = addSourceReport(session, { interruptionId: 'ir', reason: '未来来电', source: '日历', start: 30, end: 40, resolution: RESOLUTION.CONFIRMED });
  session = rep.session;
  const after = derive(session).schedule;
  const audit = diffSchedules(before, after);
  assert.equal(audit.doubleCountDeductions.length, 0);
  near(after.stages[0].countedMinutes, 20); // 前沿前无打断
});

test('15. 任意场景下计入与剩余之和守恒', () => {
  const session = createSession({
    nowMinutes: 75,
    stages: [stage(1, 40, 'A', STAGE_STATUS.DONE), stage(2, 60, 'B', STAGE_STATUS.ACTIVE), stage(3, 20, 'C')],
    interruptions: [
      intt('i1', '来电', [src('日历', 10, 20, RESOLUTION.CONFIRMED)]),
      intt('i2', '同事', [src('IM', 55, 90, RESOLUTION.CONFIRMED)]), // 横跨 B
    ],
  });
  const d = derive(session);
  for (const s of d.schedule.stages) {
    near(s.countedMinutes + s.remainingMinutes, s.budgetMinutes);
  }
});

// ---------- 需求6：多源矛盾保留双方并生成可读冲突 ----------

test('16. 区间矛盾：保留双方并生成冲突记录', () => {
  const it = intt('i1', '午休被打断', [
    src('日历', 10, 20, RESOLUTION.CONFIRMED, 'r1'),
    src('主管口头', 15, 25, RESOLUTION.CONFIRMED, 'r2'),
  ]);
  const session = createSession({ stages: [stage(1, 50)], interruptions: [it] });
  const d = derive(session);
  const c = d.conflicts.find((x) => x.type === 'interval');
  assert.ok(c);
  assert.equal(c.interruptionId, 'i1');
  assert.equal(c.a.source, '日历');
  assert.equal(c.b.source, '主管口头');
  near(c.a.start, 10);
  near(c.b.end, 25);
  assert.match(c.message, /午休被打断/);
  assert.match(c.message, /日历/);
  assert.match(c.message, /主管口头/);
  // 两条原始记录都还在
  assert.equal(session.interruptions[0].sources.length, 2);
});

test('17. 消解结论矛盾：confirmed vs dismissed 不静默择一', () => {
  const it = intt('i1', '疑似来电', [
    src('日历', 10, 20, RESOLUTION.CONFIRMED, 'r1'),
    src('监控', 10, 20, RESOLUTION.DISMISSED, 'r2'),
  ]);
  const d = derive(createSession({ stages: [stage(1, 50)], interruptions: [it] }));
  const c = d.conflicts.find((x) => x.type === 'resolution');
  assert.ok(c);
  assert.match(c.message, /成立/);
  assert.match(c.message, /否决/);
  // 净打断仍计入 confirmed 那一方，但冲突必须存在（不静默）
  assert.equal(d.netIntervals.length, 1);
});

test('18. 相同来源内容重复佐证不算冲突；不相交的区间差异不算区间冲突', () => {
  const it = intt('i1', '来电', [
    src('日历', 10, 20, RESOLUTION.CONFIRMED, 'r1'),
    src('日历', 10, 20, RESOLUTION.CONFIRMED, 'r2'),
  ]);
  assert.equal(detectConflicts([it]).length, 0);
  const it2 = intt('i2', '两件事', [src('日历', 0, 10, RESOLUTION.CONFIRMED, 'a'), src('日历', 30, 40, RESOLUTION.CONFIRMED, 'b')]);
  assert.equal(detectConflicts([it2]).filter((c) => c.type === 'interval').length, 0);
});

test('19. 消解冲突后净打断随之更新，可通过 resolveSource 处理', () => {
  let session = createSession({
    stages: [stage(1, 50)],
    interruptions: [intt('i1', '来电', [
      src('日历', 10, 20, RESOLUTION.CONFIRMED, 'r1'),
      src('监控', 10, 20, RESOLUTION.DISMISSED, 'r2'),
    ])],
  });
  assert.equal(derive(session).conflicts.length, 1);
  const r = resolveSource(session, 'i1', 'r2', RESOLUTION.CONFIRMED); // 双方一致成立
  assert.equal(r.ok, true);
  session = r.session;
  assert.equal(derive(session).conflicts.length, 0);
  assert.equal(derive(session).netIntervals.length, 1);
});

// ---------- 需求7 的可推导部分：拒绝原因可读、即时可重算 ----------

test('20. derive 在校验失败时不产出排程但仍给冲突，拒绝原因可读', () => {
  const d = derive(createSession({
    stages: [stage(1, -5)],
    interruptions: [intt('i', 'x', [src('', 10, 10, RESOLUTION.PENDING)])],
  }));
  assert.equal(d.ok, false);
  assert.equal(d.schedule, null);
  assert.ok(d.errors.length >= 2);
  assert.ok(d.errors.every((e) => typeof e.message === 'string' && e.message.length > 0));
});

test('22. 补报只影响发生阶段及其后续，更早的已完成阶段保持不变', () => {
  // s1[0,50] done；s2[50,100]；s3[100,140]。now=140（s2 也已实际走完，但状态 active）
  let session = createSession({
    nowMinutes: 140,
    stages: [stage(1, 50, '设计', STAGE_STATUS.DONE), stage(2, 50, '实现', STAGE_STATUS.ACTIVE), stage(3, 40, '复盘')],
    interruptions: [],
  });
  const before = derive(session).schedule;
  // 补报发生在 s2 窗内 [60,80]
  const rep = addSourceReport(session, { interruptionId: 'i', reason: '来电', source: '日历', start: 60, end: 80, resolution: RESOLUTION.CONFIRMED });
  assert.equal(rep.ok, true);
  const after = derive(rep.session).schedule;
  const audit = diffSchedules(before, after);

  // s1 完全不变
  const a1 = after.stages[0], b1 = before.stages[0];
  near(a1.windowStart, b1.windowStart);
  near(a1.windowEnd, b1.windowEnd);
  near(a1.countedMinutes, b1.countedMinutes);
  assert.deepEqual(audit.unchangedStages, ['s1']);
  // s2 窗 [50,120]（50 工作+20 打断），s3 起点 100→120
  near(after.stages[1].windowStart, 50);
  near(after.stages[1].windowEnd, 120);
  near(after.stages[2].windowStart, 120);
  // 变化阶段名单确定
  assert.deepEqual(audit.changedStages.map((c) => c.stageId).sort(), ['s2', 's3']);
});

test('21. 净打断横跨阶段边界时按相交切开，分别顺延', () => {
  // s1 预算 40，窗 [0,40]；净打断 [30,60] 横跨 s1/s2
  // s1 窗扩张：相交 [30,40]=10 → [0,50]；再与 [30,60] 相交 [30,50]=20 → [0,60]；
  //   再交 [30,60] → 30 → 窗 70 … 会无限增长！这是模型的边界情形，需要引擎防御。
  // —— 一个打断区间不能把阶段窗「推」过打断终点：窗内含打断总长最多 = 净打断全长 30，
  //    定点迭代以窗与净区间的交集计长会反复计同一段。该测试记录正确语义：
  //    s1 窗 [0,70]（40 工作 + 30 打断），s2 窗 [70,110]。
  const session = createSession({
    stages: [stage(1, 40, 'A'), stage(2, 40, 'B')],
    interruptions: [intt('i', '长打断', [src('日历', 30, 60, RESOLUTION.CONFIRMED)])],
  });
  const d = derive(session);
  near(d.schedule.stages[0].windowEnd, 70);
  near(d.schedule.stages[1].windowStart, 70);
  near(d.schedule.stages[0].interruptionInWindow, 30);
});
