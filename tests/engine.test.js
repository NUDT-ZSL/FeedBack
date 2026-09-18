/**
 * 引擎测试（纯 Node，无第三方依赖）：node tests/engine.test.js
 * 覆盖：配置校验（重复/悬空/自引用/成环/依赖未声明）、四态、改答传播与依据、
 * 保留不清空、失活恢复不重复计进度、前进守卫不改状态、跳过。
 */
'use strict';

const assert = require('assert');
const { validateConfig, createGuide, GuideConfigError } = require('../js/engine.js');
const DEMO = require('../js/config.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write('  ✓ ' + name + '\n'); }
  catch (e) {
    process.stdout.write('  ✗ ' + name + '\n');
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}
const section = (t) => process.stdout.write('\n[' + t + ']\n');

/** 构造一份最简有效配置，各用例在此基础上改动 */
function baseCfg() {
  return JSON.parse(JSON.stringify({ x: 0 })) || {};
}
function cfg() {
  return {
    stages: [{ id: 'a', title: 'A' }],
    steps: [
      {
        id: 's1', title: '步骤1', stage: 'a',
        questions: [
          { id: 'q1', title: '问题1', type: 'radio', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] },
          {
            id: 'q2', title: '问题2', type: 'text',
            dependsOn: ['q1'], condition: (a) => a.q1 === 'x'
          },
          {
            id: 'q3', title: '问题3', type: 'text',
            dependsOn: ['q2'], condition: () => true
          }
        ]
      },
      {
        id: 's2', title: '步骤2', stage: 'a',
        questions: [{ id: 'q4', title: '问题4', type: 'text' }]
      }
    ]
  };
}

// ===========================================================================
section('一、配置校验：拒绝并指出位置 / 链条');
// ===========================================================================

test('合法配置通过校验（示例配置也必须合法）', () => {
  assert.strictEqual(validateConfig(cfg()).valid, true);
  assert.strictEqual(validateConfig(DEMO).valid, true);
});

test('问题标识重复被拒绝，并给出两处位置', () => {
  const c = cfg();
  c.steps[1].questions.push({ id: 'q1', title: '重复问题' });
  const v = validateConfig(c);
  assert.strictEqual(v.valid, false);
  const e = v.errors.find((x) => x.code === 'E_DUP_ID');
  assert.ok(e, '应报告 E_DUP_ID');
  assert.ok(/重复/.test(e.message));
  assert.ok(/步骤序列第 2 项/.test(e.location) && /步骤序列第 1 项/.test(e.message),
    '错误信息应指出两处位置：' + e.message + ' || ' + e.location);
});

test('步骤标识与问题标识同命名空间，重复也拒绝', () => {
  const c = cfg();
  c.steps[1].questions.push({ id: 's1', title: '与步骤重名' });
  const v = validateConfig(c);
  assert.ok(v.errors.some((e) => e.code === 'E_DUP_ID'));
});

test('依赖引用未登记对象被拒绝并指出引用者与被引用 id', () => {
  const c = cfg();
  c.steps[0].questions[1].dependsOn = ['q_ghost'];
  const v = validateConfig(c);
  const e = v.errors.find((x) => x.code === 'E_UNKNOWN_REF');
  assert.ok(e);
  assert.ok(/q_ghost/.test(e.message) && /q2/.test(e.message));
  assert.ok(/步骤序列第 1 项/.test(e.location));
});

test('条件函数访问了未在 dependsOn 声明的标识被拒绝', () => {
  const c = cfg();
  c.steps[0].questions[1].dependsOn = [];
  c.steps[0].questions[1].condition = (a) => a.q1 === 'x';
  const v = validateConfig(c);
  assert.ok(v.errors.some((e) => e.code === 'E_DEP_NOT_DECLARED'));
});

test('直接依赖成环被拒绝，chain 给出完整闭环链条', () => {
  const c = {
    steps: [
      { id: 's1', title: 's1', questions: [
        { id: 'a', title: 'a', dependsOn: ['c'], condition: (x) => !!x.c },
        { id: 'b', title: 'b', dependsOn: ['a'], condition: (x) => !!x.a },
        { id: 'c', title: 'c', dependsOn: ['b'], condition: (x) => !!x.b }
      ] }
    ]
  };
  const v = validateConfig(c);
  const e = v.errors.find((x) => x.code === 'E_CYCLE');
  assert.ok(e, '必须报告成环');
  const ids = e.chain.map((n) => n.id);
  assert.strictEqual(ids[0], ids[ids.length - 1], '链条首尾相接显式闭环');
  assert.deepStrictEqual([...new Set(ids)].sort(), ['a', 'b', 'c']);
  assert.ok(/a → .* → a/.test(e.message.replace(/\n/g, ' ')) || /成环/.test(e.message));
});

test('经步骤依赖间接成环也被拒绝', () => {
  // 步骤 s2 依赖 q9（s1 中的问题），而 q9 的条件又依赖 s2 步骤依赖……
  // 构造：s2.condition 依赖 q9；q9 在 s2 中且依赖 q8（s1），q8 在 s1 中依赖 q9（跨步骤）=> 环 q8→q9→s2→q8?
  // 更直接：s2 依赖 q8；q8(s1) 依赖 q9；q9(s2) 依赖 q8 —— owner 图里 q8→q9→q8 已含，改纯步骤继承场景：
  const c = {
    steps: [
      { id: 's1', title: 's1', questions: [
        { id: 'q8', title: 'q8', dependsOn: ['q9'], condition: (x) => !!x.q9 }
      ] },
      {
        id: 's2', title: 's2', dependsOn: ['q8'], condition: (x) => !!x.q8,
        questions: [
          { id: 'q9', title: 'q9', condition: () => true } // q9 求值依赖步骤 s2；s2 依赖 q8；q8 依赖 q9 => 环
        ]
      }
    ]
  };
  const v = validateConfig(c);
  assert.ok(v.errors.some((e) => e.code === 'E_CYCLE'), '间接环必须被求值图检测到');
});

test('自引用被拒绝', () => {
  const c = { steps: [{ id: 's1', title: 's1', questions: [
    { id: 'a', title: 'a', dependsOn: ['a'], condition: (x) => !!x.a }
  ] }] };
  assert.ok(validateConfig(c).errors.some((e) => e.code === 'E_SELF_REF'));
});

test('步骤条件依赖本步骤内问题被拒绝（鸡生蛋）', () => {
  const c = { steps: [{
    id: 's1', title: 's1', dependsOn: ['q1'], condition: (x) => x.q1 === 'z',
    questions: [{ id: 'q1', title: 'q1', type: 'text' }]
  }] };
  assert.ok(validateConfig(c).errors.some((e) => e.code === 'E_STEP_SELF_DEP'));
});

test('createGuide 对非法配置抛 GuideConfigError 且携带 errors', () => {
  const c = cfg();
  delete c.steps[0].questions[0].id;
  assert.throws(() => createGuide(c), (e) => e instanceof GuideConfigError && e.errors.length > 0);
});

// ===========================================================================
section('二、四种问题状态与基本作答');
// ===========================================================================

test('初始：当前步骤问题为未到达（未作答），后续步骤问题也是未到达', () => {
  const g = createGuide(cfg());
  assert.strictEqual(g.getQuestionState('q1'), 'unreached');
  assert.strictEqual(g.getStepState('s2'), 'unreached');
});

test('作答后变为已确认；前进后后续步骤激活', () => {
  const g = createGuide(cfg());
  g.answer('q1', 'x');
  assert.strictEqual(g.getQuestionState('q1'), 'confirmed');
  // q2 条件满足但未答 => 未到达
  assert.strictEqual(g.getQuestionState('q2'), 'unreached');
  g.answer('q2', '内容2');
  g.answer('q3', '内容3');
  g.advance('s1');
  assert.strictEqual(g.getStepState('s2'), 'active');
  g.answer('q4', '内容4');
  assert.strictEqual(g.getStepState('s2'), 'done');
});

test('条件不满足的问题为未激活', () => {
  const g = createGuide(cfg());
  g.answer('q1', 'y');
  assert.strictEqual(g.getQuestionState('q2'), 'inactive');
});

// ===========================================================================
section('三、改答传播：判定沿用 / 重新确认，并逐项说明依据');
// ===========================================================================

test('改答使直接下游失活：保留原值；恢复同值后原样确认', () => {
  const g = createGuide(cfg());
  g.answer('q1', 'x');
  g.answer('q2', '原答案');
  g.answer('q3', '下游答案');
  assert.strictEqual(g.getQuestionState('q2'), 'confirmed');
  assert.strictEqual(g.getQuestionState('q3'), 'confirmed');

  const r = g.answer('q1', 'y'); // q2 条件变为不成立
  assert.strictEqual(g.getQuestionState('q2'), 'inactive');
  assert.strictEqual(g.getAnswer('q2'), '原答案', '失活也必须保留原答案');
  // q3 自身条件恒成立，但其依赖 q2 失活 => 待重新确认（同样保留答案）
  assert.strictEqual(g.getQuestionState('q3'), 'needsReconfirm');
  assert.strictEqual(g.getAnswer('q3'), '下游答案');
  assert.ok(r.change.becameInactive.includes('q2'));
  assert.ok(r.change.becamePending.includes('q3'));

  // 改回 x：所有输入与提交时基线一致 => 原样恢复，无需重填
  g.answer('q1', 'x');
  assert.strictEqual(g.getQuestionState('q2'), 'confirmed');
  assert.strictEqual(g.getQuestionState('q3'), 'confirmed');
  assert.strictEqual(g.getAnswer('q2'), '原答案');
  assert.strictEqual(g.getAnswer('q3'), '下游答案');
});

test('依赖值改变但条件仍成立：下游有答案 => 待重新确认并保留原值', () => {
  const c = {
    steps: [{ id: 's1', title: 's1', questions: [
      { id: 'n', title: '数字', type: 'number' },
      { id: 'd', title: '下游（永远成立）', type: 'text', dependsOn: ['n'], condition: () => true }
    ] }]
  };
  const g = createGuide(c);
  g.answer('n', 1);
  g.answer('d', '保留我');
  g.answer('n', 2);
  assert.strictEqual(g.getQuestionState('d'), 'needsReconfirm');
  assert.strictEqual(g.getAnswer('d'), '保留我', '不得静默清空');
  const reasons = g.getReasons('d');
  assert.strictEqual(reasons[0].kind, 'changed');
  assert.strictEqual(reasons[0].from, 1);
  assert.strictEqual(reasons[0].to, 2);
  assert.strictEqual(reasons[0].depId, 'n');

  // 重新确认（哪怕值不变）即恢复 confirmed
  g.answer('d', '保留我');
  assert.strictEqual(g.getQuestionState('d'), 'confirmed');
});

test('多级依赖：上游改动沿链级联挂起，依据中含完整链条', () => {
  const c = {
    steps: [{ id: 's1', title: 's1', questions: [
      { id: 'a', title: 'A', type: 'number' },
      { id: 'b', title: 'B', type: 'number', dependsOn: ['a'], condition: () => true },
      { id: 'cc', title: 'C', type: 'number', dependsOn: ['b'], condition: () => true }
    ] }]
  };
  const g = createGuide(c);
  g.answer('a', 1); g.answer('b', 2); g.answer('cc', 3);
  g.answer('a', 9);
  assert.strictEqual(g.getQuestionState('b'), 'needsReconfirm');
  assert.strictEqual(g.getQuestionState('cc'), 'needsReconfirm');
  const rC = g.getReasons('cc')[0];
  assert.strictEqual(rC.kind, 'upstream');
  assert.deepStrictEqual(rC.path, ['cc', 'b']);
  assert.strictEqual(rC.root.depId, 'a');
  // 逐级重确认：b 以原值重确认后，c 的直接依赖 b 值与 c 提交基线一致（2），
  // 且 b 已确认 => c 自动恢复，无需重填
  g.answer('b', 2);
  assert.strictEqual(g.getQuestionState('cc'), 'confirmed');
  assert.strictEqual(g.getAnswer('cc'), 3);
});

test('未受影响的答案保持已确认且值不变', () => {
  const c = {
    steps: [{ id: 's1', title: 's1', questions: [
      { id: 'a', title: 'A', type: 'text' },
      { id: 'b', title: 'B', type: 'text' } // 不依赖 a
    ] }]
  };
  const g = createGuide(c);
  g.answer('a', '1'); g.answer('b', '2');
  g.answer('a', '11');
  assert.strictEqual(g.getQuestionState('b'), 'confirmed');
  assert.strictEqual(g.getAnswer('b'), '2');
});

test('change 报告正确分类：失效 / 挂起 / 保留原值', () => {
  const g = createGuide(cfg());
  g.answer('q1', 'x'); g.answer('q2', 'v2'); g.answer('q3', 'v3');
  const ch = g.answer('q1', 'y').change;
  assert.ok(ch.becameInactive.includes('q2'), '条件不再成立的 q2 转为失活');
  assert.ok(ch.becamePending.includes('q3'), 'q2 失活波及 q3 待重确认');
  assert.strictEqual(g.getQuestionState('q3'), 'needsReconfirm');
  assert.strictEqual(g.getAnswer('q2'), 'v2');
  assert.strictEqual(g.getAnswer('q3'), 'v3');
});

// ===========================================================================
section('四、步骤条件失活 / 恢复：保留、不丢失、不重复计进度');
// ===========================================================================

test('专项步骤失活时其答案转为保留未激活；恢复后原样回到流程', () => {
  const g = createGuide(DEMO);
  const ans = (qid, v) => g.answer(qid, v);
  ans('applicant_type', 'person');
  g.advance('s_identity');
  ans('person_name', '张三'); ans('person_id', '110101...');
  g.advance('s_basic');
  // 补贴类型未选，三类专项步骤条件均不成立 => 未激活（不是「未到达」）
  assert.strictEqual(g.getStepState('s_startup'), 'inactive');
  ans('subsidy_type', 'startup');
  g.advance('s_subsidy');
  assert.strictEqual(g.getStepState('s_startup'), 'active');
  ans('license_no', 'L001'); ans('startup_date', '2026-01-01'); ans('hire_plan', false);
  assert.strictEqual(g.getAnswer('license_no'), 'L001');

  // 改补贴类型 => 创业专项步骤失活
  g.goTo('s_subsidy');
  g.answer('subsidy_type', 'hire');
  assert.strictEqual(g.getStepState('s_startup'), 'inactive');
  assert.strictEqual(g.getQuestionState('license_no'), 'inactive');
  assert.strictEqual(g.getAnswer('license_no'), 'L001', '答案保留');

  // 恢复
  g.answer('subsidy_type', 'startup');
  assert.notStrictEqual(g.getStepState('s_startup'), 'inactive');
  assert.strictEqual(g.getQuestionState('license_no'), 'confirmed', '恢复后原样确认，不要求重填');
  assert.strictEqual(g.getAnswer('license_no'), 'L001');
});

test('失活步骤不阻挡前进、不计入缺口；恢复后进度不重复累加', () => {
  const g = createGuide(DEMO);
  g.answer('applicant_type', 'person');
  g.advance('s_identity');
  g.answer('person_name', '张三');
  g.answer('person_id', 'ID');
  g.advance('s_basic');
  g.answer('subsidy_type', 'training'); // 创业/吸纳步骤均失活
  g.advance('s_subsidy');
  // s_startup / s_hire 均失活，可直接到达培训步骤
  assert.strictEqual(g.getStepState('s_startup'), 'inactive');
  assert.strictEqual(g.getStepState('s_hire'), 'inactive');
  assert.notStrictEqual(g.getStepState('s_training'), 'unreached');

  const p1 = g.progress();
  g.answer('subsidy_type', 'startup');
  g.answer('subsidy_type', 'training'); // 来回切换
  const p2 = g.progress();
  // 培训步骤尚未作答，切换不应改变 confirmed 数量
  assert.strictEqual(p2.confirmed, p1.confirmed, '进度不重复计入');
});

// ===========================================================================
section('五、前进守卫：阻止、指出缺口与依赖链，且不改动任何状态');
// ===========================================================================

test('必答未完成时前进被阻止，指出缺失问题', () => {
  const g = createGuide(cfg());
  g.answer('q1', 'x'); // q2、q3 未答
  const before = JSON.stringify(g.getState());
  let caught = null;
  try { g.advance('s1'); } catch (e) { caught = e; }
  assert.ok(caught, '必须抛出');
  assert.strictEqual(caught.reason.code, 'ADVANCE_BLOCKED');
  const ids = caught.reason.missing.map((m) => m.questionId);
  assert.ok(ids.includes('q2') && ids.includes('q3'));
  assert.strictEqual(JSON.stringify(g.getState()), before, '被阻止后状态必须原样不变');
});

test('待重新确认未处理时前进被阻止，missing 中带依赖链', () => {
  const c = {
    steps: [{ id: 's1', title: 's1', questions: [
      { id: 'a', title: 'A', type: 'number' },
      { id: 'b', title: 'B', type: 'text', dependsOn: ['a'], condition: () => true }
    ] }]
  };
  const g = createGuide(c);
  g.answer('a', 1); g.answer('b', 'v');
  g.answer('a', 2); // b 待重新确认
  const before = JSON.stringify(g.getState());
  try {
    g.advance('s1');
    assert.fail('应当被阻止');
  } catch (e) {
    assert.strictEqual(e.reason.missing[0].status, 'pending');
    assert.deepStrictEqual(e.reason.missing[0].chain, ['b', 'a']);
  }
  assert.strictEqual(JSON.stringify(g.getState()), before, '被阻止后状态必须原样不变');
  assert.strictEqual(g.getAnswer('b'), 'v', '原答案保留');
});

test('不能在未激活问题上作答；拒绝后不影响任何内容', () => {
  const g = createGuide(cfg());
  g.answer('q1', 'y'); // q2 未激活
  const before = JSON.stringify(g.getState());
  assert.throws(() => g.answer('q2', '强行作答'), (e) => e.reason.code === 'ANSWER_INACTIVE');
  assert.strictEqual(JSON.stringify(g.getState()), before);
});

test('不能跳去未到达的步骤', () => {
  const g = createGuide(cfg());
  assert.throws(() => g.goTo('s2'), (e) => e.reason.code === 'STEP_UNREACHED');
});

// ===========================================================================
section('六、跳过与选填');
// ===========================================================================

test('不可跳过步骤在有必答缺口时不能 skipStep；可跳过步骤可跳过并可返回', () => {
  const g = createGuide(cfg());
  assert.throws(() => g.skipStep('s1'), (e) => e.reason.code === 'STEP_NOT_SKIPPABLE');

  const g2 = createGuide(DEMO);
  // 一路填到 s_extra
  g2.answer('applicant_type', 'person');
  g2.advance('s_identity');
  g2.answer('person_name', '张'); g2.answer('person_id', 'I');
  g2.advance('s_basic');
  g2.answer('subsidy_type', 'training');
  g2.advance('s_subsidy');
  g2.answer('course_name', '课程'); g2.answer('training_hours', 40);
  g2.answer('completed', false);
  g2.advance('s_training');
  g2.answer('account_name', '张'); g2.answer('account_bank', 'ICBC'); g2.answer('account_no', '622');
  g2.advance('s_bank');
  assert.strictEqual(g2.getStepState('s_extra'), 'done'); // 全部选填、留空即满足
  g2.skipStep('s_extra');
  assert.strictEqual(g2.getStepState('s_extra'), 'skipped');
  g2.unskipStep('s_extra');
  assert.strictEqual(g2.getStepState('s_extra'), 'done');
  // 选填题留空也可以前进（显式跳过进入提交步）
  g2.skipStep('s_extra');
  g2.answer('promise', true);
  assert.strictEqual(g2.advance('s_submit').finished, true);
});

test('progress 百分比随确认数变化', () => {
  const g = createGuide(cfg());
  assert.strictEqual(g.progress().confirmed, 0);
  g.answer('q1', 'x');
  assert.strictEqual(g.progress().confirmed, 1);
});

process.stdout.write('\n通过 ' + passed + ' 项\n');
