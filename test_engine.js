'use strict';
const assert = require('assert');
const E = require('./engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok - ' + name); }
  catch (e) { console.error('FAIL - ' + name); console.error(e); process.exitCode = 1; }
}
function schema(fields) { return { fields: fields }; }
function ev(id, seq, fieldId, source, raw) {
  return { id: id, seq: seq, fieldId: fieldId, source: source, raw: raw };
}
/** 深比较（键序无关），用于 增量==全量 断言 */
function deepEqual(a, b, path) {
  path = path || '';
  if (a === b) return;
  if (typeof a !== typeof b || a === null || b === null ||
      typeof a !== 'object') {
    throw new Error('mismatch at ' + path + ': ' +
      JSON.stringify(a) + ' !== ' + JSON.stringify(b));
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  assert.deepStrictEqual(ka, kb, 'keys differ at ' + path);
  ka.forEach(function (k) { deepEqual(a[k], b[k], path + '.' + k); });
}
function assertIncrementalEqualsFull(s, events, res, base, changed, label) {
  const full = E.deriveForm(s, events, res);
  const inc = E.deriveFormIncremental(s, events, res, base, changed);
  const incClean = JSON.parse(JSON.stringify(inc));
  delete incClean.recomputed;
  deepEqual(full, incClean);
  return inc;
}

// ---------- 需求1+3：格式/必填/依赖/输入方式，可确认与阻塞 ----------
test('基本推导：可确认与阻塞字段', function () {
  const s = schema([
    { id: 'name', label: '姓名', required: true, pattern: '\\S{2,}',
      methods: ['keyboard', 'voice'] },
    { id: 'age', label: '年龄', required: false, pattern: '\\d{1,3}',
      methods: ['keyboard'] },
    { id: 'city', label: '城市', required: true, dependsOn: ['name'],
      methods: ['keyboard', 'paste'] }
  ]);
  const r = E.deriveForm(s, [
    ev('e1', 1, 'name', 'keyboard', '张三'),
    ev('e2', 2, 'age', 'keyboard', 'abc'),   // 格式不符
    ev('e3', 3, 'city', 'paste', '北京')
  ]);
  assert.strictEqual(r.fields.name.status, 'confirmable');
  assert.strictEqual(r.fields.age.status, 'blocked');
  assert.strictEqual(r.fields.age.errors[0].code, 'FORMAT');
  assert.deepStrictEqual(r.fields.age.errors[0].attribution.events, ['e2']);
  assert.strictEqual(r.fields.city.status, 'confirmable');
  assert.strictEqual(r.canSubmit, false);
});

test('依赖前置未确认则阻塞，确认后放行', function () {
  const s = schema([
    { id: 'a', required: true, methods: ['keyboard'] },
    { id: 'b', required: true, dependsOn: ['a'], methods: ['keyboard'] }
  ]);
  let r = E.deriveForm(s, [ev('e1', 1, 'b', 'keyboard', 'x')]);
  assert.strictEqual(r.fields.a.status, 'blocked');
  assert.strictEqual(r.fields.b.status, 'blocked');
  assert.strictEqual(r.fields.b.errors[0].code, 'DEP_UNCONFIRMED');
  r = E.deriveForm(s, [ev('e1', 1, 'b', 'keyboard', 'x'),
    ev('e2', 2, 'a', 'keyboard', 'ok')]);
  assert.strictEqual(r.fields.b.status, 'confirmable');
  assert.strictEqual(r.canSubmit, true);
});

// ---------- 需求2：多来源、顺序、同字段多事件 ----------
test('多条一致事件按序合并，后到的同值事件不改变结论', function () {
  const s = schema([{ id: 'f', required: true,
    methods: ['keyboard', 'voice', 'paste'] }]);
  const r = E.deriveForm(s, [
    ev('e2', 2, 'f', 'voice', '  hello '),
    ev('e1', 1, 'f', 'keyboard', 'hello'),
    ev('e3', 3, 'f', 'paste', 'hello')
  ]);
  assert.strictEqual(r.fields.f.value, 'hello'); // trim 归一化
  assert.strictEqual(r.fields.f.status, 'confirmable');
  assert.strictEqual(r.fields.f.candidates.length, 1);
  assert.strictEqual(r.fields.f.candidates[0].events.length, 3);
});

test('开关输入归一化', function () {
  assert.strictEqual(E.normalize('ON', 'toggle'), 'on');
  assert.strictEqual(E.normalize('关', 'toggle'), 'off');
  const s = schema([{ id: 't', required: true, methods: ['toggle'] }]);
  const r = E.deriveForm(s, [ev('e1', 1, 't', 'toggle', 'true')]);
  assert.strictEqual(r.fields.t.value, 'on');
  assert.strictEqual(r.fields.t.status, 'confirmable');
});

// ---------- 需求4：矛盾事件保留双方依据，裁决后才出结论 ----------
test('矛盾输入进入 conflict，保留全部来源与依据', function () {
  const s = schema([{ id: 'f', required: true,
    methods: ['keyboard', 'voice'] }]);
  const r = E.deriveForm(s, [
    ev('k1', 1, 'f', 'keyboard', '13800000000'),
    ev('v1', 2, 'f', 'voice', '13900000000')
  ]);
  assert.strictEqual(r.fields.f.status, 'conflict');
  assert.strictEqual(r.fields.f.value, null);
  const vals = r.fields.f.candidates.map(function (c) { return c.value; }).sort();
  assert.deepStrictEqual(vals, ['13800000000', '13900000000']);
  const srcs = {};
  r.fields.f.candidates.forEach(function (c) {
    c.events.forEach(function (e) { srcs[e.source] = e.raw; });
  });
  assert.strictEqual(srcs.keyboard, '13800000000');
  assert.strictEqual(srcs.voice, '13900000000');
});

test('选定某条事件裁决后给出结论，下游随即可确认', function () {
  const s = schema([
    { id: 'f', required: true, methods: ['keyboard', 'voice'] },
    { id: 'g', required: true, dependsOn: ['f'], methods: ['keyboard'] }
  ]);
  const events = [ev('k1', 1, 'f', 'keyboard', 'aa'),
    ev('v1', 2, 'f', 'voice', 'bb'), ev('g1', 3, 'g', 'keyboard', 'g')];
  let r = E.deriveForm(s, events);
  assert.strictEqual(r.fields.g.status, 'blocked');
  r = E.deriveForm(s, events, { f: { type: 'event', eventId: 'v1' } });
  assert.strictEqual(r.fields.f.value, 'bb');
  assert.strictEqual(r.fields.f.status, 'confirmable');
  assert.strictEqual(r.fields.g.status, 'confirmable');
});

test('手工裁决值仍受格式校验', function () {
  const s = schema([{ id: 'f', required: true, pattern: '\\d+',
    methods: ['keyboard'] }]);
  const r = E.deriveForm(s, [ev('k1', 1, 'f', 'keyboard', '12')],
    { f: { type: 'manual', value: 'abc' } });
  assert.strictEqual(r.fields.f.status, 'blocked');
  assert.strictEqual(r.fields.f.errors[0].attribution.manual, true);
});

// ---------- 需求6：成环 / 前置缺失 / 输入方式不可用 ----------
test('依赖成环标为不可信并说明原因', function () {
  const s = schema([
    { id: 'a', required: true, dependsOn: ['b'], methods: ['keyboard'] },
    { id: 'b', required: true, dependsOn: ['a'], methods: ['keyboard'] },
    { id: 'c', required: true, dependsOn: ['b'], methods: ['keyboard'] }
  ]);
  const events = [ev('1', 1, 'a', 'keyboard', 'x'),
    ev('2', 2, 'b', 'keyboard', 'y'), ev('3', 3, 'c', 'keyboard', 'z')];
  const r = E.deriveForm(s, events);
  assert.strictEqual(r.fields.a.status, 'untrusted');
  assert.strictEqual(r.fields.b.status, 'untrusted');
  assert.ok(/成环/.test(r.fields.a.reasons.join()));
  assert.strictEqual(r.fields.c.status, 'blocked'); // 下游不是静默跳过
  assert.strictEqual(r.fields.c.errors[0].code, 'DEP_UNCONFIRMED');
  assert.strictEqual(r.canSubmit, false);
});

test('自依赖也成环', function () {
  const s = schema([{ id: 'a', dependsOn: ['a'], methods: ['keyboard'] }]);
  const r = E.deriveForm(s, []);
  assert.strictEqual(r.fields.a.status, 'untrusted');
});

test('前置字段缺失标为不可信', function () {
  const s = schema([{ id: 'a', dependsOn: ['ghost'], methods: ['keyboard'] }]);
  const r = E.deriveForm(s, [ev('1', 1, 'a', 'keyboard', 'x')]);
  assert.strictEqual(r.fields.a.status, 'untrusted');
  assert.strictEqual(r.fields.a.errors[0].code, 'DEP_MISSING');
});

test('输入方式不可用：事件归属错误并被拒绝', function () {
  const s = schema([{ id: 'f', required: true, methods: ['keyboard'] }]);
  const r = E.deriveForm(s, [ev('v1', 1, 'f', 'voice', 'hi')]);
  assert.strictEqual(r.fields.f.status, 'blocked');
  assert.strictEqual(r.fields.f.errors[0].code, 'METHOD_UNAVAILABLE');
  assert.strictEqual(r.fields.f.errors[0].attribution.event, 'v1');
  assert.strictEqual(r.fields.f.rejected.length, 1);
});

test('可用方式与不可用方式并存：拒绝错误事件，保留合法结论', function () {
  const s = schema([{ id: 'f', required: true,
    methods: ['keyboard', 'paste'] }]);
  const r = E.deriveForm(s, [
    ev('v1', 1, 'f', 'voice', 'wrong'),
    ev('k1', 2, 'f', 'keyboard', 'right')
  ]);
  assert.strictEqual(r.fields.f.value, 'right');
  assert.strictEqual(r.fields.f.status, 'confirmable');
  assert.strictEqual(r.fields.f.errors[0].code, 'METHOD_UNAVAILABLE');
});

test('孤儿事件与重复事件在表单级报错，不静默丢弃', function () {
  const s = schema([{ id: 'f', methods: ['keyboard'] }]);
  const r = E.deriveForm(s, [
    ev('e1', 1, 'f', 'keyboard', 'a'),
    ev('e1', 2, 'f', 'keyboard', 'b'),
    ev('e2', 3, 'nope', 'keyboard', 'c')
  ]);
  const codes = r.formErrors.map(function (e) { return e.code; });
  assert.ok(codes.indexOf('EVENT_DUP') >= 0);
  assert.ok(codes.indexOf('EVENT_ORPHAN') >= 0);
  assert.strictEqual(r.fields.f.value, 'a');
});

// ---------- 需求5：增量更新只动受影响字段，且与全量推导一致 ----------
const s5 = schema([
  { id: 'a', required: true, methods: ['keyboard', 'voice'] },
  { id: 'b', required: true, dependsOn: ['a'], methods: ['keyboard'] },
  { id: 'c', required: true, dependsOn: ['b'], methods: ['keyboard', 'paste'] },
  { id: 'd', required: true, methods: ['keyboard'] },
  { id: 'e', required: false, dependsOn: ['c'], methods: ['keyboard'] }
]);

test('增量：新增 a 的事件只重算 a 及下游 b/c/e，d 不重算', function () {
  const ev0 = [ev('d1', 1, 'd', 'keyboard', 'd')];
  const base = E.deriveForm(s5, ev0);
  const ev1 = ev0.concat([ev('a1', 2, 'a', 'keyboard', 'hello')]);
  const inc = assertIncrementalEqualsFull(s5, ev1, {}, base, ['a'], 'add-a');
  assert.deepStrictEqual(inc.recomputed.sort(), ['a', 'b', 'c', 'e']);
  assert.strictEqual(inc.fields.d.status, 'blocked'); // 与全量一致
});

test('增量：用户手工修正字段，结果与全量一致', function () {
  const evs = [
    ev('a1', 1, 'a', 'keyboard', 'bad?'),
    ev('b1', 2, 'b', 'keyboard', 'b'),
    ev('c1', 3, 'c', 'keyboard', 'c')
  ];
  const base = E.deriveForm(s5, evs);
  assert.strictEqual(base.fields.b.status, 'blocked');
  const res = { a: { type: 'manual', value: 'fixed' } };
  const inc = assertIncrementalEqualsFull(s5, evs, res, base, ['a'], 'fix-a');
  assert.deepStrictEqual(inc.recomputed.sort(), ['a', 'b', 'c', 'e']);
  assert.strictEqual(inc.fields.a.value, 'fixed');
});

test('增量：裁决矛盾字段，下游自动放行，与全量一致', function () {
  const evs = [
    ev('a1', 1, 'a', 'keyboard', 'x'),
    ev('a2', 2, 'a', 'voice', 'y'),
    ev('b1', 3, 'b', 'keyboard', 'b'),
    ev('c1', 4, 'c', 'keyboard', 'c'),
    ev('d1', 5, 'd', 'keyboard', 'd')
  ];
  const base = E.deriveForm(s5, evs);
  assert.strictEqual(base.fields.a.status, 'conflict');
  const res = { a: { type: 'event', eventId: 'a2' } };
  const inc = assertIncrementalEqualsFull(s5, evs, res, base, ['a'], 'resolve-a');
  assert.strictEqual(inc.fields.a.value, 'y');
  assert.strictEqual(inc.fields.c.status, 'confirmable');
});

test('增量：调整依赖关系（新增/删除边）与全量一致', function () {
  const evs = [
    ev('a1', 1, 'a', 'keyboard', 'a'),
    ev('b1', 2, 'b', 'keyboard', 'b'),
    ev('c1', 3, 'c', 'keyboard', 'c'),
    ev('d1', 4, 'd', 'keyboard', 'd')
  ];
  const base = E.deriveForm(s5, evs);
  // 让 d 新依赖 a（d 被调整），让 b 不再依赖 a（b 被调整）
  const s6 = schema([
    { id: 'a', required: true, methods: ['keyboard', 'voice'] },
    { id: 'b', required: true, dependsOn: [], methods: ['keyboard'] },
    { id: 'c', required: true, dependsOn: ['b'], methods: ['keyboard', 'paste'] },
    { id: 'd', required: true, dependsOn: ['a'], methods: ['keyboard'] },
    { id: 'e', required: false, dependsOn: ['c'], methods: ['keyboard'] }
  ]);
  const inc = assertIncrementalEqualsFull(s6, evs, {}, base,
    ['b', 'd'], 'reedge');
  assert.ok(inc.recomputed.indexOf('d') >= 0);
  assert.strictEqual(inc.fields.d.status, 'confirmable');
});

test('增量：引入依赖环，环成员标不可信，与全量一致', function () {
  const evs = [
    ev('a1', 1, 'a', 'keyboard', 'a'),
    ev('b1', 2, 'b', 'keyboard', 'b')
  ];
  const base = E.deriveForm(s5, evs);
  const sCycle = schema([
    { id: 'a', required: true, dependsOn: ['b'],
      methods: ['keyboard', 'voice'] },
    { id: 'b', required: true, dependsOn: ['a'], methods: ['keyboard'] },
    { id: 'c', required: true, dependsOn: ['b'], methods: ['keyboard', 'paste'] },
    { id: 'd', required: true, methods: ['keyboard'] },
    { id: 'e', required: false, dependsOn: ['c'], methods: ['keyboard'] }
  ]);
  const inc = assertIncrementalEqualsFull(sCycle, evs, {}, base,
    ['a'], 'cycle');
  assert.strictEqual(inc.fields.a.status, 'untrusted');
  assert.strictEqual(inc.fields.b.status, 'untrusted');
  assert.strictEqual(inc.fields.d.status, 'blocked');
});

test('增量：无 base 时退化为全量推导', function () {
  const r = E.deriveFormIncremental(s5, [], {}, null, ['a']);
  assert.strictEqual(r.fields.a.status, 'blocked');
});

console.log('\n' + passed + ' tests passed');

