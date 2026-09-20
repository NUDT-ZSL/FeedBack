'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { solve } = require('../solver.js');

const P = (id, requested, priority, min, deps = [], extra = {}) =>
  Object.assign({ id, name: id, requested, priority, min, deps, locked: null, excluded: false }, extra);
const amt = (out, id) => out.results.find(r => r.id === id).amount;
const res = (out, id) => out.results.find(r => r.id === id);

test('资金充足时全部足额满足', () => {
  const out = solve({ budget: 1000, projects: [P('A', 300, 5, 100), P('B', 200, 1, 50)] });
  assert.strictEqual(amt(out, 'A'), 300);
  assert.strictEqual(amt(out, 'B'), 200);
  assert.strictEqual(out.conflicts.length, 0);
});

test('高优先级优先足额，低优先级仅保最低', () => {
  const out = solve({ budget: 500, projects: [P('A', 400, 5, 100), P('B', 400, 1, 100)] });
  assert.strictEqual(amt(out, 'A'), 400);
  assert.strictEqual(amt(out, 'B'), 100);
});

test('同优先级层内均衡注水：小额申请先被填满，而非按比例平摊', () => {
  const out = solve({ budget: 350, projects: [P('A', 300, 5, 0), P('B', 100, 5, 0)] });
  assert.strictEqual(amt(out, 'B'), 100);
  assert.strictEqual(amt(out, 'A'), 250);
});

test('最低投入得到保障', () => {
  const out = solve({ budget: 600, projects: [P('A', 500, 5, 200), P('B', 500, 1, 200)] });
  assert.ok(amt(out, 'A') >= 200);
  assert.ok(amt(out, 'B') >= 200);
});

test('锁定金额被尊重，且重推与从头推导一致（纯函数确定性）', () => {
  const input = {
    budget: 500,
    projects: [P('A', 300, 5, 100), P('B', 300, 4, 100, [], { locked: 150 })]
  };
  const out1 = solve(input);
  const out2 = solve(input);
  assert.strictEqual(amt(out1, 'B'), 150);
  assert.strictEqual(amt(out1, 'A'), 300);
  assert.deepStrictEqual(out1, out2);
});

test('排除项目不参与分配，其下游被阻断', () => {
  const out = solve({
    budget: 1000,
    projects: [P('A', 100, 5, 50, [], { excluded: true }), P('B', 100, 5, 50, ['A'])]
  });
  assert.strictEqual(amt(out, 'A'), 0);
  assert.strictEqual(amt(out, 'B'), 0);
  assert.strictEqual(res(out, 'B').status, 'blocked');
});

test('依赖闭环被明确标出并说明冲突类型', () => {
  const out = solve({
    budget: 1000,
    projects: [P('A', 100, 5, 0, ['B']), P('B', 100, 5, 0, ['A']), P('C', 100, 5, 0, ['A'])]
  });
  const c = out.conflicts.find(x => x.type === 'cycle');
  assert.ok(c, '应报告 cycle 冲突');
  assert.ok(c.projects.includes('A') && c.projects.includes('B'));
  assert.strictEqual(res(out, 'A').status, 'conflict');
  assert.strictEqual(res(out, 'B').status, 'conflict');
  assert.strictEqual(res(out, 'C').status, 'blocked');
});

test('最低投入之和超过资金时标出无法满足的项目', () => {
  const out = solve({ budget: 150, projects: [P('A', 200, 5, 100), P('B', 200, 1, 100)] });
  const c = out.conflicts.find(x => x.type === 'min_overflow');
  assert.ok(c, '应报告 min_overflow 冲突');
  assert.deepStrictEqual(c.projects, ['B']);
  assert.strictEqual(res(out, 'B').status, 'unmet');
  assert.strictEqual(amt(out, 'A'), 100);
});

test('前置未获足额支持时项目不进入可分配状态，释放的资金回流', () => {
  const out = solve({ budget: 250, projects: [P('A', 300, 5, 100), P('B', 100, 4, 50, ['A'])] });
  assert.strictEqual(amt(out, 'B'), 0);
  assert.strictEqual(res(out, 'B').status, 'blocked');
  assert.strictEqual(amt(out, 'A'), 250);
});

test('求解确定性：多次求解结果完全一致', () => {
  const input = {
    budget: 777,
    projects: [P('A', 300, 5, 100), P('B', 200, 5, 50, ['A']), P('C', 400, 3, 100)]
  };
  assert.strictEqual(JSON.stringify(solve(input)), JSON.stringify(solve(input)));
});

test('前置后来获足额支持的项目会被加回分配（贪心回填）', () => {
  // E 依赖 B、C；首轮 B 不足额使 E 退出，B 足额后 E 应被加回并保住最低投入
  const out = solve({
    budget: 1000,
    projects: [
      P('A', 300, 5, 200),
      P('B', 200, 4, 100, ['A']),
      P('C', 350, 5, 250, ['A']),
      P('D', 180, 3, 80, ['C']),
      P('E', 120, 2, 60, ['B', 'C']),
      P('F', 150, 2, 50, ['E'])
    ]
  });
  assert.strictEqual(amt(out, 'A'), 300);
  assert.strictEqual(amt(out, 'B'), 200);
  assert.strictEqual(amt(out, 'C'), 350);
  assert.strictEqual(amt(out, 'D'), 90);
  assert.strictEqual(amt(out, 'E'), 60);
  assert.strictEqual(res(out, 'E').status, 'partial');
  assert.strictEqual(amt(out, 'F'), 0);
  assert.strictEqual(res(out, 'F').status, 'blocked');
});

test('加回会挤占前置足额支持的项目被确定性拒绝，且说明原因', () => {
  // D 的最低投入会挤占 B 的足额资金：D 不应进入，且结果不得振荡
  const input = {
    budget: 900,
    projects: [
      P('A', 300, 5, 200),
      P('B', 200, 4, 100, ['A']),
      P('C', 400, 4, 300),
      P('D', 120, 2, 60, ['B'])
    ]
  };
  const out = solve(input);
  assert.strictEqual(amt(out, 'A'), 300);
  assert.strictEqual(amt(out, 'B'), 200);
  assert.strictEqual(amt(out, 'C'), 400);
  assert.strictEqual(amt(out, 'D'), 0);
  assert.strictEqual(res(out, 'D').status, 'blocked');
  assert.ok(/挤占/.test(res(out, 'D').constraint));
  assert.strictEqual(JSON.stringify(out), JSON.stringify(solve(input)));
});
