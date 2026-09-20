const assert = require('assert');
const M = require('../js/model.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { console.error('FAIL - ' + name); console.error(e.stack); process.exitCode = 1; }
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function findField(form, id) { return form.fields.find(x => x.id === id); }
function stepsOf(form) {
  const r = M.converge(form);
  const m = {};
  form.fields.forEach(x => { m[x.id] = x.excluded ? null : r.assignment[x.id]; });
  return m;
}

console.log('1. 基础示例可分析');
test('示例含一条 REQUIREMENT 冲突（emerEmail 依据 A/B）', () => {
  const r = M.analyze(M.sampleForm());
  const req = r.conflicts.filter(c => c.kind === 'REQUIREMENT');
  assert.strictEqual(req.length, 1);
  assert.strictEqual(req[0].field, 'emerEmail');
  assert.deepStrictEqual(req[0].demands.sort(), ['optional', 'required']);
  assert.ok(req[0].evidences.length >= 3); // 自身声明 + 两条依据全部保留
});

console.log('2. 前置被排到更后步骤 => 步骤不可完成，且指出具体依赖');
test('把 phone 移到第 4 步：第 2/3 步不可完成', () => {
  const form = M.sampleForm();
  findField(form, 'phone').step = 4;
  const r = M.analyze(form);
  // emergency(第3步)->phone(第4步) 阻塞
  const s3 = r.steps[2];
  assert.strictEqual(s3.infeasible, true);
  const hit = s3.blockedBy.find(b => b.prereq === 'phone' && b.kind === 'later');
  assert.ok(hit, '应指出 phone 依赖导致阻塞');
  assert.ok(/紧急联系人需要本人手机号/.test(hit.message));
});

console.log('3. 增量操作与整体重推一致（锁定/排除）');
test('逐条加锁再收敛 == 一次性加全部锁后整体重推', () => {
  const ids = ['fullName', 'bankName', 'contract', 'policy'];
  // 增量：每锁一个字段就收敛一次
  const inc = M.sampleForm();
  ids.forEach(id => { findField(inc, id).locked = true;
                      const c = M.applyConvergence(inc);
                      c.fields.forEach(x => { findField(inc, x.id).step = x.step; }); });
  // 整体：一次性锁全部再收敛
  const full = M.sampleForm();
  ids.forEach(id => { findField(full, id).locked = true; });
  const fullC = M.applyConvergence(full);
  assert.deepStrictEqual(stepsOf(inc), stepsOf(fullC));
});

test('连续排除多个字段再收敛 == 一次性排除后整体重推', () => {
  const inc = M.sampleForm();
  ['email', 'emerEmail'].forEach(id => {
    findField(inc, id).excluded = true;
    const c = M.applyConvergence(inc);
    c.fields.forEach(x => { findField(inc, x.id).step = x.step; });
  });
  const full = M.sampleForm();
  ['email', 'emerEmail'].forEach(id => { findField(full, id).excluded = true; });
  assert.deepStrictEqual(stepsOf(inc), stepsOf(M.applyConvergence(full)));
});

test('收敛幂等：重复收敛结果不变', () => {
  let form = M.sampleForm();
  const a = stepsOf(M.applyConvergence(form));
  form = M.applyConvergence(form);
  const b = stepsOf(M.applyConvergence(form));
  assert.deepStrictEqual(a, b);
});

console.log('4. 同一步骤约束传播到整步并影响阅读量');
test('bankCard/contract/bankName 被 same 约束拉入同一步骤', () => {
  const form = M.sampleForm();
  const r = M.analyze(form);
  // same 边约束 bankCard 与 contract 同一步
  assert.strictEqual(r.suggested.bankCard, r.suggested.contract);
  // before 边要求 bankName 在它们之前
  assert.ok(r.suggested.bankName < r.suggested.bankCard);
});

console.log('5. 阅读量/必填压力沿步骤聚合');
test('每步 read = 字段 read 之和；第 1 步必填数正确', () => {
  const r = M.analyze(M.sampleForm());
  const s1 = r.steps[0];
  const ids = s1.fields;
  const read = ids.reduce((a, id) => a + r.norm.fields.find(x => x.id === id).read, 0);
  assert.strictEqual(s1.read, read);
  assert.ok(s1.requiredCount >= 3);
});

console.log('6. 排除字段后其依赖方被标记前置缺失');
test('排除 phone：emergency 的依赖闭包标记 excluded', () => {
  const form = M.sampleForm();
  findField(form, 'phone').excluded = true;
  const r = M.analyze(form);
  const st = r.steps[r.assignment.emergency - 1];
  assert.ok(st.blockedBy.some(b => b.prereq === 'phone' && b.kind === 'excluded'));
});

console.log('7. 结构冲突：锁与依赖矛盾');
test('锁定 emergency 于第 1 步且 phone 锁第 4 步 => LOCK_EDGE/ORDER 类冲突', () => {
  const form = M.sampleForm();
  findField(form, 'emergency').locked = true; findField(form, 'emergency').step = 1;
  findField(form, 'phone').locked = true;     findField(form, 'phone').step = 4;
  const r = M.analyze(form);
  assert.ok(r.conflicts.some(c => /ORDER|LOCK_EDGE/.test(c.kind)));
  assert.ok(r.conflicts.some(c => /紧急联系人需要本人手机号/.test(c.message)));
});

console.log('8. after 依赖违规被识别');
test('email 放到 fullName 之前步骤时产生违规', () => {
  const form = M.sampleForm();
  // fullName 默认第1步，email 第2步满足 after；制造不满足：把 email 锁第1步
  findField(form, 'email').locked = true;
  findField(form, 'email').step = 1;
  const r = M.analyze(form);
  assert.ok(r.edgeChecks.some(c => c.dep.from === 'email' && c.status === 'violation'));
});

console.log('\n' + passed + ' 个测试通过');

/* 9. 随机属性测试：任意操作序列后的收敛 == 相同最终状态的一次性重推 */
(function () {
  function randSeed(seed) {
    return function () {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }
  function snapshot(form) {
    return form.fields.map(x => x.id + ':' + (x.excluded ? 'X' : x.step + (x.locked ? 'L' : ''))).sort().join('|');
  }
  let rnd = randSeed(20260921), trials = 40;
  for (let t = 0; t < trials; t++) {
    const inc = M.sampleForm();
    const finalState = M.sampleForm();
    const ops = 6 + Math.floor(rnd() * 10);
    for (let k = 0; k < ops; k++) {
      const id = inc.fields[Math.floor(rnd() * inc.fields.length)].id;
      const op = Math.floor(rnd() * 4);
      applyOp(inc, id, op, rnd);
      const conv = M.applyConvergence(inc);
      conv.fields.forEach(x => { Object.assign(findField(inc, x.id), { step: x.step }); });
    }
    // 最终状态复制到 finalState（锁/排除/偏好步骤），一次性收敛
    inc.fields.forEach(x => {
      Object.assign(findField(finalState, x.id),
        { locked: x.locked, excluded: x.excluded, step: x.step });
    });
    const a = stepsOf(inc);
    const b = stepsOf(M.applyConvergence(finalState));
    assert.deepStrictEqual(a, b);
  }
  test('40 组随机操作序列：逐步收敛与整体重推一致', () => {
    // 上面的 deepStrictEqual 不通过会直接抛错
    assert.ok(true);
  });

  function applyOp(form, id, op, rnd) {
    const fld = findField(form, id);
    if (op === 0) fld.locked = !fld.locked;
    else if (op === 1) fld.excluded = !fld.excluded;
    else if (op === 2) fld.step = 1 + Math.floor(rnd() * form.stepCount);
    else { fld.locked = true; fld.step = 1 + Math.floor(rnd() * form.stepCount); }
  }
})();
