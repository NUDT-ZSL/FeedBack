/* 引擎单元测试：node tests/engine.test.js */
'use strict';
const assert = require('assert');
const E = require('../engine.js');

const C = { width: 400, padding: 10, gap: 10, lineGap: 10 };

function mk(o) {
  return Object.assign({
    intrinsicW: 100, intrinsicH: 40, flexGrow: 0,
    minW: 0, maxW: null, minH: 0, maxH: null,
    canWrap: true, baselineAlign: false, fixed: null
  }, o);
}

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok - ' + name); }

// 1. 确定性：同一输入两次推导结果一致
test('确定性：同一输入哈希一致', () => {
  const blocks = [mk({ id: 'a' }), mk({ id: 'b', flexGrow: 1 }), mk({ id: 'c', intrinsicW: 300 })];
  const r1 = E.layout(blocks, C);
  const r2 = E.layout(blocks, C);
  assert.strictEqual(r1.hash, r2.hash);
  assert.deepStrictEqual(r1.placed, r2.placed);
});

// 2. 内边距与间距共同决定位置
test('内边距与间距参与定位', () => {
  const r = E.layout([mk({ id: 'a' }), mk({ id: 'b' })], C);
  assert.strictEqual(r.placed.a.x, 10);
  assert.strictEqual(r.placed.a.y, 10);
  assert.strictEqual(r.placed.b.x, 10 + 100 + 10);
});

// 3. 可换行块移到下一行；不可换行块保留并报溢出冲突
test('换行与不可换行溢出', () => {
  const r1 = E.layout([mk({ id: 'a', intrinsicW: 300 }), mk({ id: 'b', intrinsicW: 200 })], C);
  assert.strictEqual(r1.placed.b.line, 1);
  const r2 = E.layout([
    mk({ id: 'a', intrinsicW: 300, minW: 300 }),
    mk({ id: 'b', intrinsicW: 200, minW: 150, canWrap: false })
  ], C);
  assert.strictEqual(r2.placed.b.line, 0);
  assert.ok(r2.conflicts.some(c => c.type === 'no-wrap-overflow' &&
    c.parties.includes('b') && c.parties.includes('container')));
  assert.ok(r2.flags.b.overflow);
});

// 4. 剩余空间按伸缩权重分配且受 maxW 约束
test('伸缩分配与 maxW 约束', () => {
  const r = E.layout([
    mk({ id: 'a', flexGrow: 1, maxW: 120 }),
    mk({ id: 'b', flexGrow: 1 })
  ], C);
  // 可用 380，间距 10，余量 170；a 先到 120（+20），其余 150 全给 b
  assert.strictEqual(r.placed.a.w, 120);
  assert.strictEqual(r.placed.b.w, 250);
});

// 5. 挤压：保留 minW 与间距，冲突双方都在，块标记 squeezed/overflow
test('挤压冲突双方保留', () => {
  const r2 = E.layout([
    mk({ id: 'a', intrinsicW: 200, minW: 180, canWrap: false }),
    mk({ id: 'b', intrinsicW: 200, minW: 180, canWrap: false })
  ], { width: 340, padding: 10, gap: 10, lineGap: 10 }); // 可用 320 < 370
  assert.strictEqual(r2.placed.a.w, 180);
  assert.strictEqual(r2.placed.b.w, 180);
  const cf = r2.conflicts.find(c => c.type === 'squeeze-overflow');
  assert.ok(cf, '应存在 squeeze-overflow 冲突');
  assert.ok(cf.parties.includes('a') && cf.parties.includes('b') && cf.parties.includes('container'));
  assert.ok(r2.flags.a.squeezed && r2.flags.b.squeezed);
  assert.ok(r2.flags.b.overflow);
});

// 6. 基线对齐：同一行内基线对齐块基线重合
test('基线对齐共同决定纵向位置', () => {
  const r = E.layout([
    mk({ id: 'a', intrinsicH: 40, baselineAlign: true }),
    mk({ id: 'b', intrinsicH: 60, baselineAlign: true })
  ], C);
  const blA = r.placed.a.y + r.placed.a.h * E.BASELINE_RATIO;
  const blB = r.placed.b.y + r.placed.b.h * E.BASELINE_RATIO;
  assert.ok(Math.abs(blA - blB) < 1e-6, '基线应重合');
  assert.strictEqual(r.lines[0].height, 60);
});

// 7. 固定尺寸违反边界：两者均保留并报告
test('固定尺寸与边界冲突保留', () => {
  const r = E.layout([mk({ id: 'a', minW: 80, fixed: { w: 50, h: null } })], C);
  assert.strictEqual(r.placed.a.w, 50);
  assert.ok(r.conflicts.some(c => c.type === 'fixed-vs-min' &&
    c.parties.includes('a') && c.parties.includes('minW=80')));
});

// 8. 不静默丢弃：所有输入块都有位置
test('所有块均被放置', () => {
  const blocks = [];
  for (let i = 0; i < 20; i++) blocks.push(mk({ id: 'b' + i, intrinsicW: 90 }));
  const r = E.layout(blocks, C);
  blocks.forEach(b => assert.ok(r.placed[b.id], b.id + ' 应有位置'));
});

// 9. 增量重推与全链重推一致（固定中间块尺寸）
test('增量重推与全链一致', () => {
  const blocks = [
    mk({ id: 'a', intrinsicW: 150, flexGrow: 1 }),
    mk({ id: 'b', intrinsicW: 120 }),
    mk({ id: 'c', intrinsicW: 200, flexGrow: 2 }),
    mk({ id: 'd', intrinsicW: 90 })
  ];
  const prev = E.layout(blocks, C);
  const changed = blocks.map(b => b.id === 'b' ? Object.assign({}, b, { fixed: { w: 260, h: null } }) : b);
  const inc = E.layoutIncremental(prev, changed, C, 'b');
  const full = E.layout(changed, C);
  assert.strictEqual(inc.mode, 'partial');
  assert.strictEqual(inc.result.hash, full.hash);
  assert.deepStrictEqual(inc.result.conflicts, full.conflicts);
  assert.deepStrictEqual(inc.result.reasons, full.reasons);
});

// 10. 增量重推：变更引发换行级联时仍与全链一致
test('增量重推级联换行一致', () => {
  const blocks = [
    mk({ id: 'a', intrinsicW: 100 }),
    mk({ id: 'b', intrinsicW: 100 }),
    mk({ id: 'c', intrinsicW: 100 }),
    mk({ id: 'd', intrinsicW: 100 })
  ];
  const prev = E.layout(blocks, C);
  const changed = blocks.map(b => b.id === 'a' ? Object.assign({}, b, { fixed: { w: 300, h: null } }) : b);
  const inc = E.layoutIncremental(prev, changed, C, 'a');
  const full = E.layout(changed, C);
  assert.strictEqual(inc.result.hash, full.hash);
  assert.strictEqual(full.lines.length, 2); // a 独占一行，b/c/d 被级联挤到第二行
});

// 11. 容器参数变化时增量退化为全链
test('容器变化回退全链', () => {
  const blocks = [mk({ id: 'a' })];
  const prev = E.layout(blocks, C);
  const inc = E.layoutIncremental(prev, blocks, { width: 500, padding: 10, gap: 10, lineGap: 10 }, 'a');
  assert.strictEqual(inc.mode, 'full');
});

console.log('\n' + n + ' 个测试全部通过');
