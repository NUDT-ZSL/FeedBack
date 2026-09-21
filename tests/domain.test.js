const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/domain.js');

function element(id, role, name, parentId = null, order = 1, hidden = false) {
  return { id, role, name, parentId, order, hidden };
}

test('根据父子关系和同级顺序构建语义树并生成朗读顺序', () => {
  const elements = [
    element('window', 'dialog', '设置', null, 1),
    element('b', 'button', '保存', 'window', 2),
    element('n', 'textbox', '姓名', 'window', 1),
    element('line', 'presentation', '装饰线', 'window', 3),
    element('tabs', 'tablist', '分类', 'window', 4),
    element('tab-a', 'tab', '资料', 'tabs', 2),
    element('tab-b', 'tab', '安全', 'tabs', 1)
  ];
  const result = D.createSnapshot(elements, {});
  assert.equal(result.ok, true);
  const plan = D.getReadingPlan(result.snapshot.elements);
  assert.deepEqual(plan.sequence.map((item) => item.id),
    ['window', 'n', 'b', 'tabs', 'tab-b', 'tab-a']);
  assert.equal(plan.skipped[0].id, 'line');
  assert.match(plan.skipped[0].reason, /不产生语义朗读/);
});

test('隐藏节点的整棵子树进入跳过列表', () => {
  const result = D.createSnapshot([
    element('root', 'dialog', '根', null, 1),
    element('hidden', 'generic', '隐藏区', 'root', 1, true),
    element('child', 'button', '隐藏按钮', 'hidden', 1)
  ], {});
  const plan = D.getReadingPlan(result.snapshot.elements);
  assert.deepEqual(plan.sequence.map((item) => item.id), ['root']);
  assert.deepEqual(plan.skipped.map((item) => item.id), ['hidden', 'child']);
  assert.match(plan.skipped[1].reason, /祖先/);
});

test('缺失可读名称、缺失父级和无效顺序被阻止且带定位信息', () => {
  const result = D.createSnapshot([
    { id: 'a', role: 'button', name: '', parentId: null, order: 1 },
    { id: 'b', role: 'button', name: '子项', parentId: 'missing', order: -1 }
  ], {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'missing-name' && e.elementId === 'a'));
  assert.ok(result.errors.some((e) => e.code === 'missing-parent' && e.elementId === 'b' && /b → missing/.test(e.relation)));
  assert.ok(result.errors.some((e) => e.code === 'invalid-order' && e.elementId === 'b'));
});

test('同一父级下重复的同级顺序被阻止', () => {
  const result = D.createSnapshot([
    element('root', 'dialog', '根', null, 1),
    element('a', 'button', 'A', 'root', 2),
    element('b', 'button', 'B', 'root', 2),
    element('other-root', 'region', '其他顶层', null, 2)
  ], {});
  assert.equal(result.ok, false);
  const duplicate = result.errors.filter((error) => error.code === 'duplicate-order');
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].elementId, 'b');
  assert.match(duplicate[0].relation, /root \/ order 2/);
});

test('直接自引用循环被阻止并指出冲突关系', () => {
  const result = D.createSnapshot([
    { id: 'a', role: 'group', name: 'A', parentId: 'a', order: 1 }
  ], {});
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'cycle');
  assert.equal(result.errors[0].elementId, 'a');
  assert.equal(result.errors[0].relation, 'a → a');
});

test('间接循环和进入循环的孤立后代被阻止', () => {
  const result = D.createSnapshot([
    element('root', 'dialog', '根', null, 1),
    element('a', 'group', 'A', 'b', 1),
    element('b', 'group', 'B', 'a', 2),
    element('c', 'button', '进入循环', 'a', 1)
  ], {});
  assert.equal(result.ok, false);
  const cycles = result.errors.filter((error) => error.code === 'cycle');
  const orphans = result.errors.filter((error) => error.code === 'orphan');
  assert.equal(cycles.length, 1);
  assert.ok(['a', 'b'].includes(cycles[0].elementId));
  assert.match(cycles[0].message, /父子关系形成循环/);
  assert.ok(orphans.some((error) => error.elementId === 'c'));
});

test('调整为后代作为父级时不生效且保留原快照', () => {
  const initial = D.createSnapshot([
    element('root', 'dialog', '根', null, 1),
    element('child', 'group', '子级', 'root', 1),
    element('grand', 'button', '孙级', 'child', 1)
  ], {}).snapshot;
  const candidate = D.changeElement(initial, {
    id: 'root', role: 'dialog', name: '根', parentId: 'grand', order: 1, hidden: false
  });
  assert.equal(candidate.ok, false);
  assert.ok(candidate.errors.some((error) => error.code === 'cycle' && error.elementId === 'root'));
  assert.equal(initial.elements.find((item) => item.id === 'root').parentId, null);
});

test('移动按钮只交换同一父级内的相邻阅读顺序', () => {
  const initial = D.createSnapshot([
    element('root', 'dialog', '根', null, 1),
    element('a', 'button', 'A', 'root', 1),
    element('b', 'button', 'B', 'root', 2),
    element('c', 'button', 'C', 'root', 3)
  ], {}).snapshot;
  const moved = D.moveElement(initial, 'a', 'down').snapshot;
  assert.deepEqual(D.getReadingPlan(moved.elements).sequence.map((item) => item.id),
    ['root', 'b', 'a', 'c']);
  assert.deepEqual(D.getReadingPlan(initial.elements).sequence.map((item) => item.id),
    ['root', 'a', 'b', 'c']);
});

test('多个顶层节点作为虚拟界面根的有序子节点处理', () => {
  const result = D.createSnapshot([
    element('banner', 'banner', '横幅', null, 2),
    element('main', 'main', '主体', null, 1)
  ], {});
  assert.equal(result.ok, true);
  assert.deepEqual(D.getReadingPlan(result.snapshot.elements).sequence.map((item) => item.id),
    ['main', 'banner']);
});

test('循环检测不受元素录入顺序影响', () => {
  const base = [
    element('root', 'dialog', '根', 'grand', 1),
    element('child', 'group', '子级', 'root', 1),
    element('grand', 'group', '孙级', 'child', 1)
  ];
  for (let index = 0; index < base.length; index += 1) {
    const permutation = base.slice(index).concat(base.slice(0, index));
    const result = D.createSnapshot(permutation, {});
    assert.equal(result.ok, false, `排列 ${index + 1} 必须失败`);
    assert.equal(result.errors.filter((error) => error.code === 'cycle').length, 1);
    assert.deepEqual([...new Set(result.errors[0].message.match(/root|child|grand/g))].sort(),
      ['child', 'grand', 'root']);
  }
});
