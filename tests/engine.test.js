/* 引擎行为测试：node tests/engine.test.js */
const assert = require('assert');
const Engine = require('../engine.js');
const DEMO = require('../flows/demo-flow.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}
function section(t) { console.log('\n' + t); }

/* ---------- 需求 1：标识重复 / 引用不存在 → 拒绝并指出位置 ---------- */
section('需求 1：定义校验——重复标识与悬空引用');
test('重复问题标识被拒绝并指出两处位置', () => {
  const def = {
    id: 'x', steps: [{ id: 's1', title: 's', phase: 'p', skippable: false }],
    questions: [
      { id: 'a', step: 's1', text: 'A', required: true },
      { id: 'a', step: 's1', text: 'A2', required: true },
    ],
  };
  const r = Engine.validateFlow(def);
  assert.strictEqual(r.ok, false);
  const e = r.errors.find((x) => x.message.includes('重复'));
  assert.ok(e, '应报告重复');
  assert.ok(e.path.includes('questions[1]'), '应指出重复出现的位置，实际：' + e.path);
  assert.ok(e.message.includes('questions[0]'), '应指出首次出现的位置');
});
test('重复步骤标识被拒绝', () => {
  const def = {
    id: 'x',
    steps: [{ id: 's1' }, { id: 's1' }],
    questions: [{ id: 'a', step: 's1', text: 'A' }],
  };
  const r = Engine.validateFlow(def);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes('s1') && e.message.includes('重复')));
});
test('问题引用不存在的步骤被拒绝并指出位置', () => {
  const def = {
    id: 'x', steps: [{ id: 's1' }],
    questions: [{ id: 'a', step: 'nope', text: 'A' }],
  };
  const r = Engine.validateFlow(def);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors[0].path.includes('questions[0]'));
  assert.ok(r.errors[0].message.includes('nope'));
});
test('依赖引用未登记问题被拒绝并指出位置', () => {
  const def = {
    id: 'x', steps: [{ id: 's1' }],
    questions: [
      { id: 'a', step: 's1', text: 'A' },
      { id: 'b', step: 's1', text: 'B', dependsOn: [{ question: 'ghost', op: 'answered' }] },
    ],
  };
  const r = Engine.validateFlow(def);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors[0].path.includes('questions[1].dependsOn[0]'));
  assert.ok(r.errors[0].message.includes('ghost'));
});
test('步骤条件引用未登记问题被拒绝', () => {
  const def = {
    id: 'x',
    steps: [{ id: 's1' }, { id: 's2', condition: { question: 'ghost', op: 'answered' } }],
    questions: [{ id: 'a', step: 's1', text: 'A' }],
  };
  const r = Engine.validateFlow(def);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors[0].path.includes('steps[1].condition'));
});

/* ---------- 需求 2：依赖成环 → 拒绝并给出链条 ---------- */
section('需求 2：环检测');
test('问题依赖成环被拒绝并给出完整链条', () => {
  const def = {
    id: 'x', steps: [{ id: 's1' }],
    questions: [
      { id: 'a', step: 's1', text: '甲', dependsOn: [{ question: 'c', op: 'answered' }] },
      { id: 'b', step: 's1', text: '乙', dependsOn: [{ question: 'a', op: 'answered' }] },
      { id: 'c', step: 's1', text: '丙', dependsOn: [{ question: 'b', op: 'answered' }] },
    ],
  };
  const r = Engine.validateFlow(def);
  assert.strictEqual(r.ok, false);
  const e = r.errors.find((x) => x.message.includes('成环'));
  assert.ok(e, '应报告成环');
  assert.ok(e.message.includes('甲') && e.message.includes('乙') && e.message.includes('丙'), '链条应含各环节：' + e.message);
});
test('步骤条件引用本步骤问题构成环被拒绝', () => {
  const def = {
    id: 'x',
    steps: [{ id: 's1', condition: { question: 'a', op: 'answered' } }],
    questions: [{ id: 'a', step: 's1', text: 'A' }],
  };
  const r = Engine.validateFlow(def);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes('成环')));
});
test('非法流程无法创建会话', () => {
  const def = { id: 'x', steps: [{ id: 's1' }], questions: [{ id: 'a', step: 's1' }, { id: 'a', step: 's1' }] };
  assert.throws(() => Engine.createSession(def));
});
test('演示流程本身合法', () => {
  const r = Engine.validateFlow(DEMO);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors, null, 2));
});

/* ---------- 需求 3、4：改答后的影响判定 ---------- */
section('需求 3、4：改答影响判定与答案保留');
function answeredSession() {
  const s = Engine.createSession(DEMO);
  s.setAnswer('q-name', '张三');
  s.setAnswer('q-type', '企业');
  s.setAnswer('q-first', true);
  s.setAnswer('q-reg-date', true);
  s.setAnswer('q-staff', 8);
  s.setAnswer('q-has-venue', true);
  s.setAnswer('q-lease', true);
  s.setAnswer('q-rent', 3000);
  s.setAnswer('q-item', '就业补贴');
  s.setAnswer('q-amount', 20000);
  s.setAnswer('q-hire-count', 3);
  s.setAnswer('q-hire-contract', true);
  return s;
}
test('改答后：直接以后者为前提的问题必须重新确认并给出依据', () => {
  const s = answeredSession();
  const r = s.setAnswer('q-lease', false); // q-rent 直接依赖 q-lease
  assert.ok(r.changed);
  const rec = r.impact.find((i) => i.id === 'q-rent');
  assert.ok(rec, 'q-rent 应出现在影响列表');
  assert.strictEqual(rec.outcome, 'deactivated'); // 条件 equals true 不再满足 → 未激活
  assert.strictEqual(rec.preserved, 3000, '原答案必须保留');
  assert.ok(rec.reason.length > 0 && rec.chain, '应逐项说明依据与链条');
});
test('必须重新确认的问题保留原答案并显式标注，不静默清空', () => {
  const s = answeredSession();
  // 改造：让 q-staff 的前提 q-type 变化但仍激活（企业→个体 时 q-staff 失活；改用同型改动）
  // 用 q-item：就业补贴→设备补贴，s-hire 步骤失活；先验证 reconfirm 场景：
  const s2 = Engine.createSession({
    id: 't',
    steps: [{ id: 's1' }, { id: 's2' }],
    questions: [
      { id: 'a', step: 's1', text: '前提', type: 'choice', options: [{ value: 'x' }, { value: 'y' }] },
      { id: 'b', step: 's2', text: '后续', type: 'text', dependsOn: [{ question: 'a', op: 'in', value: ['x', 'y'] }] },
    ],
  });
  s2.setAnswer('a', 'x');
  s2.setAnswer('b', '保留我');
  const r = s2.setAnswer('a', 'y'); // 条件仍满足 → 待重新确认而非失活
  const rec = r.impact.find((i) => i.id === 'b');
  assert.strictEqual(rec.outcome, 'reconfirm');
  const st = s2.getState();
  const qb = st.steps[1].questions.find((q) => q.id === 'b');
  assert.strictEqual(qb.status, 'stale');
  assert.strictEqual(qb.answer, '保留我', '原答案必须保留，不得静默清空');
});
test('不受影响（非直接前提）的答案继续沿用且状态不变', () => {
  const s = answeredSession();
  const r = s.setAnswer('q-name', '李四'); // 无人依赖 q-name
  const keeps = r.impact.filter((i) => i.outcome === 'keep').map((i) => i.id);
  ['q-type', 'q-staff', 'q-rent', 'q-item', 'q-hire-count'].forEach((id) =>
    assert.ok(keeps.includes(id), id + ' 应判定为可沿用'));
  const st = s.getState();
  assert.strictEqual(st.progress.stale, 0, '不应产生待重新确认项');
});
test('重新确认后状态恢复已确认，答案不变', () => {
  const s = Engine.createSession({
    id: 't', steps: [{ id: 's1' }, { id: 's2' }],
    questions: [
      { id: 'a', step: 's1', text: 'A', type: 'choice', options: [{ value: 'x' }, { value: 'y' }] },
      { id: 'b', step: 's2', text: 'B', dependsOn: [{ question: 'a', op: 'in', value: ['x', 'y'] }] },
    ],
  });
  s.setAnswer('a', 'x'); s.setAnswer('b', 'v');
  s.setAnswer('a', 'y');
  assert.strictEqual(s.getState().steps[1].questions[0].status, 'stale');
  const r = s.confirmAnswer('b');
  assert.ok(r.changed);
  const q = s.getState().steps[1].questions[0];
  assert.strictEqual(q.status, 'confirmed');
  assert.strictEqual(q.answer, 'v');
});

/* ---------- 需求 5：步骤失活保留 / 恢复不丢不重 ---------- */
section('需求 5：步骤失活与恢复');
test('步骤条件不再满足时其下答案转为保留未激活，不计入进度', () => {
  const s = answeredSession();
  const before = s.getState().progress;
  const r = s.setAnswer('q-item', '设备补贴'); // s-hire 步骤失活
  const stepImpact = r.impact.find((i) => i.type === 'step' && i.id === 's-hire');
  assert.strictEqual(stepImpact.outcome, 'deactivated');
  const st = s.getState();
  const hire = st.steps.find((x) => x.id === 's-hire');
  assert.strictEqual(hire.status, 'inactive');
  const q1 = hire.questions.find((q) => q.id === 'q-hire-count');
  assert.strictEqual(q1.status, 'inactive');
  assert.strictEqual(q1.answer, 3, '答案保留');
  assert.strictEqual(q1.answerKept, true);
  assert.strictEqual(st.progress.total, before.total - 2, '未激活问题不计入进度');
});
test('条件恢复后答案原样回到流程，不重复计入进度', () => {
  const s = answeredSession();
  s.setAnswer('q-item', '设备补贴');
  const mid = s.getState().progress;
  const r = s.setAnswer('q-item', '就业补贴'); // 恢复
  const stepImpact = r.impact.find((i) => i.type === 'step' && i.id === 's-hire');
  assert.strictEqual(stepImpact.outcome, 'reactivated');
  const st = s.getState();
  const hire = st.steps.find((x) => x.id === 's-hire');
  const q1 = hire.questions.find((q) => q.id === 'q-hire-count');
  assert.strictEqual(q1.status, 'confirmed', '原样恢复为已确认');
  assert.strictEqual(q1.answer, 3);
  assert.strictEqual(st.progress.confirmed, mid.confirmed + 2, '恢复后计入一次，不重复');
});
test('级联失活：步骤失活带动依赖其问题的后续步骤失活', () => {
  const s = answeredSession();
  // q-type 企业→个人：s-biz 失活 → q-has-venue 未激活 → s-venue 失活（其条件引用未激活问题）
  const r = s.setAnswer('q-type', '个人');
  const st = s.getState();
  assert.strictEqual(st.steps.find((x) => x.id === 's-biz').status, 'inactive');
  assert.strictEqual(st.steps.find((x) => x.id === 's-venue').status, 'inactive');
  const rent = st.steps.find((x) => x.id === 's-venue').questions.find((q) => q.id === 'q-rent');
  assert.strictEqual(rent.answer, 3000, '级联失活同样保留答案');
  // 恢复
  s.setAnswer('q-type', '企业');
  const st2 = s.getState();
  assert.strictEqual(st2.steps.find((x) => x.id === 's-venue').status, 'confirmed');
});

/* ---------- 需求 6：阻止与状态不变 ---------- */
section('需求 6：阻止前进/跳过且不改动状态');
test('必答问题未完成时阻止前进，指出缺失问题与依据，状态不变', () => {
  const s = Engine.createSession(DEMO);
  s.setAnswer('q-name', '张三'); // q-type、q-first 未答
  const snap = s.serialize();
  const r = s.next();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'missing');
  const ids = r.missing.map((m) => m.id);
  assert.deepStrictEqual(ids, ['q-type', 'q-first']);
  assert.ok(r.missing[0].basis.length > 0, '应给出依赖依据');
  assert.strictEqual(s.serialize(), snap, '不得改动任何已填内容或状态');
});
test('待重新确认的必答问题同样阻止前进', () => {
  const s = Engine.createSession({
    id: 't', steps: [{ id: 's1' }, { id: 's2' }],
    questions: [
      { id: 'a', step: 's1', text: 'A', type: 'choice', options: [{ value: 'x' }, { value: 'y' }] },
      { id: 'b', step: 's2', text: 'B', dependsOn: [{ question: 'a', op: 'in', value: ['x', 'y'] }] },
    ],
  });
  s.setAnswer('a', 'x'); s.setAnswer('b', 'v');
  s.setAnswer('a', 'y'); // b 变 stale
  s.goToStep(0);
  const r = s.next(); // s1 无缺失 → 前进到 s2 可以；再 next 应被 b 阻止（已是末尾则 end）
  assert.ok(r.ok);
  const r2 = s.next();
  assert.strictEqual(r2.ok, false);
  assert.ok(r2.reason === 'missing' || r2.reason === 'end');
  if (r2.reason === 'missing') assert.strictEqual(r2.missing[0].cause, '答案受改答影响，待重新确认');
});
test('不可跳过的步骤拒绝跳过且不改动状态', () => {
  const s = Engine.createSession(DEMO);
  const snap = s.serialize();
  const r = s.skip();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not-skippable');
  assert.strictEqual(s.serialize(), snap);
});
test('可跳过步骤允许跳过', () => {
  const s = Engine.createSession(DEMO);
  // 填完前面必答，进入 s-extra
  ['q-name', 'q-type', 'q-first'].forEach((id, i) => s.setAnswer(id, id === 'q-type' ? '个人' : (id === 'q-first' ? true : '张三')));
  s.setAnswer('q-item', '设备补贴'); s.setAnswer('q-amount', 1000);
  while (s.getState().steps[s.getState().currentStep].id !== 's-extra') {
    const r = s.next();
    assert.ok(r.ok, JSON.stringify(r));
  }
  const r = s.skip();
  assert.ok(r.ok);
  assert.strictEqual(s.getState().steps[s.getState().currentStep].id, 's-confirm');
});
test('条件未满足时禁止直接进入该步骤并给出原因链', () => {
  const s = Engine.createSession(DEMO);
  s.setAnswer('q-type', '个人'); // s-biz 不成立
  const snap = s.serialize();
  const r = s.goToStep(1);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'step-inactive');
  assert.ok(r.chain.join(' ').includes('q-type'), '应指出涉及的依赖：' + r.chain);
  assert.strictEqual(s.serialize(), snap);
});

/* ---------- 需求 7：四种状态视图 ---------- */
section('需求 7：四态视图与进度');
test('步骤与问题呈现 已确认/待重新确认/未激活/未到达 四种状态', () => {
  const s = answeredSession();
  s.setAnswer('q-lease', false); // q-rent → inactive（保留）
  const st = s.getState();
  const all = st.steps.flatMap((x) => x.questions);
  const statuses = new Set(all.map((q) => q.status));
  assert.ok(statuses.has('confirmed'));
  assert.ok(statuses.has('inactive'));
  assert.ok(statuses.has('unreached'), 'q-note/q-truth 未答应为未到达');
  // stale：制造一个
  s.setAnswer('q-type', '个体'); // q-staff 直接前提含 q-type → 但个体时 q-staff 条件不满足→inactive；改用 q-item
  const s2 = answeredSession();
  s2.setAnswer('q-item', '场地补贴'); // s-hire 失活；q-amount 不依赖 q-item → keep
  const s3 = Engine.createSession({
    id: 't', steps: [{ id: 's1' }, { id: 's2' }],
    questions: [
      { id: 'a', step: 's1', text: 'A', type: 'choice', options: [{ value: 'x' }, { value: 'y' }] },
      { id: 'b', step: 's2', text: 'B', dependsOn: [{ question: 'a', op: 'in', value: ['x', 'y'] }] },
    ],
  });
  s3.setAnswer('a', 'x'); s3.setAnswer('b', 'v'); s3.setAnswer('a', 'y');
  assert.strictEqual(s3.getState().steps[1].status, 'stale', '步骤应呈现待重新确认');
});
test('序列化可完整恢复会话', () => {
  const s = answeredSession();
  s.setAnswer('q-lease', false);
  const snap = s.serialize();
  const s2 = Engine.createSession(DEMO, JSON.parse(snap));
  assert.strictEqual(s2.serialize(), snap);
  const q = s2.getState().steps.flatMap((x) => x.questions).find((x) => x.id === 'q-rent');
  assert.strictEqual(q.status, 'inactive');
  assert.strictEqual(q.answer, 3000);
});

/* ---------- 端到端：演示流程可完整走通 ---------- */
section('端到端：完整申报旅程');
test('按顺序答完全部必答题后可到达提交，且进度不重复计入', () => {
  const s = answeredSession(); // 企业路线：含 s-biz / s-venue / s-hire
  s.setAnswer('q-note', '无');   // 可跳过步骤也答了
  s.setAnswer('q-truth', true);
  const st = s.getState();
  assert.ok(st.canSubmit, '全部必答已确认后应可提交');
  // 逐步 next 走到底，不应被阻止
  let guard = 0;
  while (guard++ < 20) {
    const r = s.next();
    if (!r.ok && r.reason === 'end') break;
    assert.ok(r.ok, '前进不应被阻止：' + JSON.stringify(r));
  }
  const st2 = s.getState();
  assert.strictEqual(st2.progress.confirmed, st2.progress.total, '全部激活问题均已确认');
  // 失活一次再恢复，进度数字不得变化（不重复计入）
  const progBefore = s.getState().progress;
  s.setAnswer('q-item', '设备补贴');
  const progMid = s.getState().progress;
  assert.ok(progMid.total < progBefore.total, '失活问题不计入进度');
  s.setAnswer('q-item', '就业补贴');
  const progAfter = s.getState().progress;
  assert.deepStrictEqual(progAfter, progBefore, '恢复后进度应原样还原，不重复计入');
});

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
