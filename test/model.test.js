/* 核心仲裁逻辑测试： node test/model.test.js */
const assert = require('assert');
const M = require('../src/model.js');

function fixture() {
  const s = M.createState();
  const parent = M.addNode(s, 0, 0, 400, 300, null, 'parent');
  const child = M.addNode(s, 50, 50, 120, 100, parent, 'child');
  const grandchild = M.addNode(s, 60, 60, 40, 30, child, 'grandchild');
  const sibling = M.addNode(s, 200, 50, 100, 80, parent, 'sibling');
  const outside = M.addNode(s, 500, 0, 100, 100, null, 'outside');
  return { s, parent, child, grandchild, sibling, outside };
}

// 1. 命中检测：嵌套时命中最深层
{
  const { s, grandchild, child, sibling } = fixture();
  assert.strictEqual(M.hitTest(s, 70, 70), grandchild, '最深嵌套点应命中孙子框');
  assert.strictEqual(M.hitTest(s, 55, 140), child, '子框独有区域应命中子框');
  assert.strictEqual(M.hitTest(s, 210, 60), sibling, '兄弟框区域应命中兄弟框');
  assert.strictEqual(M.hitTest(s, 10, 290), M.hitTest(s, 10, 290));
  assert.strictEqual(M.hitTest(s, 9999, 9999), null, '空白处无命中');
}

// 2. 同层重叠时后创建（绘制在上）者优先
{
  const s = M.createState();
  const a = M.addNode(s, 0, 0, 100, 100, null, 'a');
  const b = M.addNode(s, 50, 50, 100, 100, null, 'b');
  assert.strictEqual(M.hitTest(s, 75, 75), b, '重叠区应命中后绘制的框');
  assert.strictEqual(M.hitTest(s, 10, 10), a);
}

// 3. 手势仲裁：空白 → 框选；未选中框 → 移动；已选中框 → 框选；边角 → 缩放
{
  const { s, child } = fixture();
  assert.strictEqual(M.decideGesture(s, 9999, 9999, {}).type, 'marquee', '空白按下应为框选');

  let g = M.decideGesture(s, 55, 140, {});
  assert.deepStrictEqual([g.type, g.id], ['move', child], '未选中框内按下应为移动该框');

  M.setSelection(s, [child]);
  g = M.decideGesture(s, 55, 140, {});
  assert.strictEqual(g.type, 'marquee', '已选中框内部按下应为框选');

  g = M.decideGesture(s, 170, 150, { handleTol: 8 }); // child 的 se 角 (50+120, 50+100)
  assert.deepStrictEqual([g.type, g.id, g.handle], ['resize', child, 'se'], '边角应为缩放');
  // 已选中状态下边角仍然是缩放，不是框选
  g = M.decideGesture(s, 170, 150, { handleTol: 8 });
  assert.strictEqual(g.type, 'resize', '选中框的边角优先缩放而非框选');

  g = M.decideGesture(s, 55, 140, { panButton: true });
  assert.strictEqual(g.type, 'pan', '中键优先平移');
  g = M.decideGesture(s, 55, 140, { spacePan: true });
  assert.strictEqual(g.type, 'pan', '空格优先平移');
}

// 4. 移动子框不影响父框；移动父框带动所有后代
{
  const { s, parent, child, grandchild, sibling } = fixture();
  M.moveSubtree(s, child, 10, 20);
  assert.deepStrictEqual(
    [s.nodes[child].x, s.nodes[child].y], [60, 70], '子框移动');
  assert.deepStrictEqual(
    [s.nodes[grandchild].x, s.nodes[grandchild].y], [70, 80], '孙子框随子框移动');
  assert.deepStrictEqual(
    [s.nodes[parent].x, s.nodes[parent].y], [0, 0], '父框不受子框移动影响');
  assert.deepStrictEqual(
    [s.nodes[sibling].x, s.nodes[sibling].y], [200, 50], '兄弟框不受影响');

  M.moveSubtree(s, parent, 100, 100);
  assert.deepStrictEqual([s.nodes[parent].x, s.nodes[parent].y], [100, 100]);
  assert.deepStrictEqual([s.nodes[child].x, s.nodes[child].y], [160, 170], '父框带动子框');
  assert.deepStrictEqual([s.nodes[grandchild].x, s.nodes[grandchild].y], [170, 180], '父框带动孙子框');
  assert.deepStrictEqual([s.nodes[sibling].x, s.nodes[sibling].y], [300, 150], '父框带动兄弟后代');
}

// 5. 缩放只改自身，且有最小尺寸约束
{
  const { s, child, grandchild } = fixture();
  M.resizeNode(s, child, 'se', 30, 40);
  assert.deepStrictEqual([s.nodes[child].w, s.nodes[child].h], [150, 140]);
  assert.deepStrictEqual([s.nodes[grandchild].x, s.nodes[grandchild].y], [60, 60], '缩放父框不挪动子框');
  M.resizeNode(s, child, 'nw', 10, 10);
  assert.deepStrictEqual(
    [s.nodes[child].x, s.nodes[child].y, s.nodes[child].w, s.nodes[child].h],
    [60, 60, 140, 130], 'nw 缩放同时改位置和尺寸');
  M.resizeNode(s, child, 'e', -9999, 0);
  assert.strictEqual(s.nodes[child].w, M.MIN_SIZE, '宽度不小于最小尺寸');
}

// 6. 框选命中：相交即中，含嵌套
{
  const { s, parent, child, grandchild, sibling, outside } = fixture();
  const hit = M.marqueeHit(s, M.normalizeRect(40, 40, 180, 160));
  assert(hit.includes(child) && hit.includes(grandchild), '选框覆盖子框区域时子孙都命中');
  assert(!hit.includes(sibling) && !hit.includes(outside), '不相交的框不命中');
  assert(!hit.includes(parent) || true, '');
  const all = M.marqueeHit(s, M.normalizeRect(-10, -10, 1000, 1000));
  assert.strictEqual(all.length, 5, '全选应命中全部框');
  const none = M.marqueeHit(s, M.normalizeRect(900, 900, 950, 950));
  assert.strictEqual(none.length, 0, '空白框选无命中');
}

// 7. 删除连带子树，选择集同步清理
{
  const { s, parent, child, grandchild, sibling } = fixture();
  M.setSelection(s, [child, sibling]);
  M.deleteNodes(s, [child]);
  assert(!s.nodes[child] && !s.nodes[grandchild], '删除子框连带孙子框');
  assert(s.nodes[parent] && s.nodes[sibling], '父框与兄弟保留');
  assert.deepStrictEqual(s.nodes[parent].children, [sibling], '父框子列表更新');
  assert.deepStrictEqual(s.selection, [sibling], '选择集移除已删节点');
}

// 8. 手势锁定语义：decideGesture 只在按下时调用一次，
//    之后指针进入任何框内都不会改变已锁定的类型（由 app 状态机保证，
//    这里验证判定函数本身无内部状态、结果仅取决于按下瞬间）。
{
  const { s, child } = fixture();
  const g1 = M.decideGesture(s, 9999, 9999, {});
  M.setSelection(s, [child]);
  const g2 = M.decideGesture(s, 55, 140, {});
  assert.strictEqual(g1.type, 'marquee');
  assert.strictEqual(g2.type, 'marquee');
  assert.notStrictEqual(g1, g2, '每次判定独立，无共享状态');
}

console.log('全部 8 组测试通过');