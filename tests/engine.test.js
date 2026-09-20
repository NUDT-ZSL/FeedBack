/* Node 测试：node --test tests/engine.test.js（零依赖，内置断言） */
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');
const S = require('../src/data.js');

function f(id, step, opts) { return Object.assign({ id: id, label: id, step: step, readWeight: 1 }, opts || {}); }
function dep(id, source, target, requirement) { return { id: id, source: source, target: target, requirement: requirement }; }

test('需求1：维护字段/步骤/依赖/填写要求并允许调整归属', () => {
  const form = { config: { stepCount: 3 },
    fields: [f('a', 0, { required: true }), f('b', 1)],
    dependencies: [dep('e1', 'b', 'a', 'required')] };
  assert.strictEqual(E.analyze(form).steps[0].fieldIds[0], 'a');
  form.fields[0].step = 2;
  assert.strictEqual(E.analyze(form).steps[2].fieldIds[0], 'a');
});

test('需求2：沿依赖推出跨步骤阅读量/必填压力/前置未满足，不只看单步', () => {
  const form = { config: { stepCount: 3, readThreshold: 100 },
    fields: [f('a', 0, { readWeight: 3, required: true }), f('b', 2, { readWeight: 2 })],
    dependencies: [dep('e1', 'b', 'a', 'required')] };
  const s2 = E.analyze(form).steps[2];
  assert.strictEqual(s2.localRead, 2);
  assert.strictEqual(s2.recallRead, 3);
  assert.strictEqual(s2.totalRead, 5);
  assert.strictEqual(s2.requiredCount, 1);
  assert.strictEqual(s2.unmetCount, 0);
});

test('需求3：依赖字段排在更靠后步骤 => 标出步骤不可完成并指出具体依赖', () => {
  const form = { config: { stepCount: 3 },
    fields: [f('a', 2), f('b', 0)],
    dependencies: [dep('e1', 'b', 'a', 'required')] };
  const r = E.analyze(form);
  assert.deepStrictEqual(r.blockedFields, ['b']);
  assert.deepStrictEqual(r.summary.blockedSteps, [0]);
  const reason = r.fieldReports.get('b').reasons[0];
  assert.strictEqual(reason.code, 'future');
  assert.strictEqual(reason.depId, 'e1');
  assert.strictEqual(reason.targetId, 'a');
  assert.match(reason.text, /更靠后的步骤/);
});

test('需求3b：阻断沿依赖链传递（间接前置不可完成 => 连带不可完成）', () => {
  // 同步骤 b->a 合法，但 a 因依赖更靠后的 z 被阻断；b 经合法链连带不可完成
  const form = { config: { stepCount: 3 },
    fields: [f('z', 2), f('a', 0), f('b', 0)],
    dependencies: [dep('e1', 'a', 'z', 'required'), dep('e2', 'b', 'a', 'required')] };
  const r = E.analyze(form);
  assert.deepStrictEqual(r.blockedFields.sort(), ['a', 'b']);
  assert.ok(r.fieldReports.get('b').reasons.some(x => x.code === 'upstream'));
});

test('需求3c：循环依赖整体不可完成', () => {
  const form = { config: { stepCount: 2 },
    fields: [f('a', 0), f('b', 0)],
    dependencies: [dep('e1', 'a', 'b', 'required'), dep('e2', 'b', 'a', 'required')] };
  const r = E.analyze(form);
  assert.deepStrictEqual(r.blockedFields.sort(), ['a', 'b']);
  assert.ok(r.fieldReports.get('a').reasons.some(x => x.code === 'cycle'));
});
test('需求4：锁定位置/排除字段驱动整体重推收敛，且与整体重推一致', () => {
  // c 依赖 b 依赖 a；a 在步骤2；c 初始在步骤0；未锁定 => 收敛到 >=a 的步骤2
  const form = { config: { stepCount: 3 },
    fields: [f('a', 2, { required: true }), f('b', 1), f('c', 0)],
    dependencies: [dep('e1', 'b', 'a', 'required'), dep('e2', 'c', 'b', 'required')] };
  const c1 = E.converge(form);
  const stepOf = c => c1.form.fields.find(x => x.id === c).step;
  assert.strictEqual(stepOf('b'), 2);
  assert.strictEqual(stepOf('c'), 2);
  // 对收敛结果再收敛必须完全一致（幂等 == 整体重推一致）
  assert.deepStrictEqual(E.converge(c1.form).form, c1.form);

  // 锁定 a 在步骤2（索引1）：b 前移到步骤2，c 随之；锁定 a 自身绝不动
  const locked = JSON.parse(JSON.stringify(form));
  locked.fields[0].locked = true;
  locked.fields[0].step = 1;
  const c2 = E.converge(locked);
  assert.strictEqual(c2.form.fields.find(x => x.id === 'a').step, 1);
  assert.strictEqual(c2.infeasible.length, 0);
  assert.strictEqual(c2.form.fields.find(x => x.id === 'b').step, 1);
  assert.strictEqual(c2.form.fields.find(x => x.id === 'c').step, 1);

  // 排除 a：依赖 a 的 b 被标记阻断，排除字段不计入活跃字段
  const excluded = JSON.parse(JSON.stringify(form));
  excluded.fields[0].excluded = true;
  const r = E.analyze(excluded);
  assert.strictEqual(r.summary.excludedCount, 1);
  assert.ok(r.fieldReports.get('b').reasons.some(x => x.code === 'excluded'));
});

test('需求4b：两个锁定字段先后冲突 => infeasible 且 analyze 标出阻断', () => {
  const form = { config: { stepCount: 4 },
    fields: [f('a', 3, { locked: true }), f('b', 1, { locked: true })],
    dependencies: [dep('e1', 'b', 'a', 'required')] };
  const c = E.converge(form);
  assert.strictEqual(c.infeasible.length, 1);
  assert.strictEqual(c.infeasible[0].depId, 'e1');
  assert.match(c.infeasible[0].text, /锁定冲突/);
  assert.deepStrictEqual(E.analyze(form).blockedFields, ['b']);
});

test('需求5：同一字段多条依赖要求冲突 => 保留全部依据并标出', () => {
  const form = { config: { stepCount: 2 },
    fields: [f('x', 0), f('p', 0), f('q', 0)],
    dependencies: [dep('e1', 'p', 'x', 'required'), dep('e2', 'q', 'x', 'readOnly')] };
  const r = E.analyze(form);
  const rep = r.fieldReports.get('x');
  assert.strictEqual(rep.conflicts.length, 1);
  assert.deepStrictEqual(rep.conflicts[0].kinds.sort(), ['readOnly', 'required']);
  const ev = rep.conflicts[0].evidence.map(e => e.id).sort();
  assert.deepStrictEqual(ev, ['e1', 'e2']);
  assert.deepStrictEqual(r.conflictFields, ['x']);
  // 非冲突组合（required + skipIfFilled）不报警
  const ok = { config: { stepCount: 1 }, fields: [f('x', 0), f('p', 0), f('q', 0)],
    dependencies: [dep('e1', 'p', 'x', 'required'), dep('e2', 'q', 'x', 'skipIfFilled')] };
  assert.strictEqual(E.analyze(ok).conflictFields.length, 0);
});

test('需求6：内置示例开箱即可完整推演（阻断/冲突/步骤负担齐全）', () => {
  const r = E.analyze(S.sampleForm());
  assert.strictEqual(r.steps.length, 4);
  assert.ok(r.blockedFields.includes('guarantorName'));
  assert.ok(r.blockedFields.includes('guarantorAgreement'));
  assert.ok(r.conflictFields.includes('riskLevel'));
  assert.ok(r.conflictFields.includes('guarantorPhone'));
  assert.ok(E.converge(S.sampleForm()).infeasible.length >= 1);
});

test('阈值：高阅读/高必填压力步骤被标记', () => {
  const form = { config: { stepCount: 1, readThreshold: 5, requiredThreshold: 3 },
    fields: [f('a', 0, { readWeight: 3, required: true }),
            f('b', 0, { readWeight: 3, required: true }),
            f('c', 0, { required: true })],
    dependencies: [] };
  const s = E.analyze(form).steps[0];
  assert.strictEqual(s.highRead, true);
  assert.strictEqual(s.highRequired, true);
});
