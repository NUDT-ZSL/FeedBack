/* 推演内核冒烟测试：覆盖需求 1-5 的关键行为 */
const E = require('./engine.js');
let failed = 0;
function ok(cond, name) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failed++;
}
function baseState() {
  return {
    targets: [
      { id: 'T1', batch: 1, ready: true,  labels: { env: 'prod', region: 'cn' } },
      { id: 'T2', batch: 1, ready: false, labels: { env: 'prod', region: 'us' } },
      { id: 'T3', batch: 2, ready: true,  labels: { env: 'stg',  region: 'cn' } }
    ],
    rules: [
      { id: 'R1', key: 'feature.x', value: 'on',  scope: { env: 'prod' }, priority: 10, batch: 1, status: 'published', version: 1 },
      { id: 'R2', key: 'feature.x', value: 'off', scope: { region: 'us' }, priority: 20, batch: 1, status: 'published', version: 2 },
      { id: 'R3', key: 'feature.y', value: 'a',   scope: {},              priority: 5,  batch: 2, status: 'published', version: 3 },
      { id: 'R4', key: 'feature.x', value: 'v4',  scope: {},              priority: 99, batch: 1, status: 'draft',     version: 4 }
    ],
    overrides: {}
  };
}

// 1+2: 匹配、优先级推导、依据
let s = baseState();
let d = E.deriveAll(s, 1);
ok(d.results.T1['feature.x'].effective.ruleId === 'R1', 'T1 命中 env=prod 的 R1');
ok(d.results.T2['feature.x'].effective.ruleId === 'R2', 'T2 上 R2 优先级 20 胜出');
ok(d.results.T2['feature.x'].candidates.length === 2, 'T2 保留全部候选(2条)');
ok(d.results.T2['feature.x'].reason.indexOf('P=20') >= 0, '给出选择依据');
ok(d.results.T3['feature.x'].effective === null, 'T3(batch2) 在 step1 不受 batch1 规则影响');
ok(d.results.T1['feature.y'] === undefined || !d.results.T1['feature.y'].effective, 'step1 时 R3(batch2) 未生效');
d = E.deriveAll(s, 2);
ok(d.results.T3['feature.y'].effective.ruleId === 'R3', 'step2 时 R3 对 T3 生效');
ok(d.results.T1['feature.y'] === undefined || !d.results.T1['feature.y'].effective, 'R3 不影响 batch1 的 T1');

// 3: 冲突保留候选 + 用户裁决
s = baseState();
s.rules.push({ id: 'R5', key: 'feature.x', value: 'tie', scope: { env: 'prod' }, priority: 10, batch: 1, status: 'published', version: 5 });
d = E.deriveAll(s, 1);
ok(d.results.T1['feature.x'].conflict === true, 'R1/R5 并列 => 冲突');
ok(d.results.T1['feature.x'].effective === null, '冲突未裁决前无生效值');
ok(d.results.T1['feature.x'].candidates.length === 2, '冲突时保留全部候选');
s.overrides['T1|feature.x'] = 'R5';
d = E.deriveAll(s, 1);
ok(d.results.T1['feature.x'].effective.value === 'tie' && d.results.T1['feature.x'].adjudicated, '裁决后按用户选择生效');

// 4: 撤回 -> 增量重推与整体重推一致
s = baseState();
let r2 = s.rules.filter(r => r.id === 'R2')[0];
let affected = E.affectedTargets(s, r2);
r2.status = 'withdrawn';
let inc = E.incrementalDerive(s, 1, affected);
ok(inc.consistent === true, '撤回 R2 后增量重推与整体一致');
ok(affected.indexOf('T2') >= 0 && affected.indexOf('T1') < 0, '撤回只影响范围命中的 T2');
ok(inc.full.results.T2['feature.x'].effective.ruleId === 'R1', 'T2 回落到 R1');

// 4b: 调整作用范围 -> 增量与整体一致
s = baseState();
let r1 = s.rules.filter(r => r.id === 'R1')[0];
let oldScope = JSON.parse(JSON.stringify(r1.scope));
affected = E.affectedTargets(s, Object.assign({}, r1, { scope: { region: 'cn' } }), oldScope);
r1.scope = { region: 'cn' };
inc = E.incrementalDerive(s, 1, affected);
ok(inc.consistent === true, '改范围后增量重推与整体一致');
ok(inc.full.results.T2['feature.x'].effective.ruleId === 'R2', 'T2 不再被 R1 覆盖');

// 5: 批次可信度
s = baseState();
d = E.deriveAll(s, 2);
let b1 = d.trust.filter(t => t.batch === 1)[0];
ok(b1.trusted === false && b1.problems.some(p => p.indexOf('T2') >= 0), 'B1 因 T2 未就绪被标不可信');
s.rules.push({ id: 'R6', key: 'k', value: 'v', scope: { env: 'missing' }, priority: 1, batch: 2, status: 'published', version: 6 });
d = E.deriveAll(s, 2);
let b2 = d.trust.filter(t => t.batch === 2)[0];
ok(b2.trusted === false && b2.problems.some(p => p.indexOf('R6') >= 0), 'B2 因 R6 指向缺失被标不可信');
s.rules.push({ id: 'R7', key: 'k', value: 'v', scope: {}, priority: 1, batch: 9, status: 'published', version: 7 });
d = E.deriveAll(s, 2);
ok(d.trust.filter(t => t.batch === 9)[0].trusted === false, '指向不存在批次的规则被标不可信');

console.log(failed === 0 ? '\nALL TESTS PASSED' : '\n' + failed + ' TEST(S) FAILED');
process.exit(failed === 0 ? 0 : 1);