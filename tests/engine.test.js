/* 引擎行为测试：node tests/engine.test.js */
'use strict';
const assert = require('assert');
const Engine = require('../js/engine.js');

function freshSample() {
  const s = Engine.createState();
  const r = Engine.loadDataset(s, '台账', Engine.SAMPLE);
  assert.strictEqual(r.errors.length, 0, '样例数据不应有拒绝');
  Engine.setTarget(s, '套件', 120);
  return s;
}
const rowOf = (v, id) => v.rows.find(r => r.id === id);

// 1. 重复标识与非正用量：拒绝并指出位置
{
  const st = Engine.createState();
  assert.ok(Engine.addResource(st, 'A', 'x', 1).ok);
  const r1 = Engine.addResource(st, 'A', 'x', 2);
  assert.ok(!r1.ok && /重复/.test(r1.error) && /第 2 条/.test(r1.error), '重复资源应拒绝并给位置');
  const r2 = Engine.addRecipe(st, 'A', { id: 'p', output: { resource: 'x', qty: 0 } });
  assert.ok(!r2.ok && /正数/.test(r2.error) && /p/.test(r2.error), '非正产出用量应拒绝');
  const r3 = Engine.addRecipe(st, 'A', { id: 'p2', output: { resource: 'x', qty: 1 }, inputs: [{ resource: 'x', qty: -3 }] });
  assert.ok(!r3.ok && /正数/.test(r3.error), '非正投入用量应拒绝');
  const r4 = Engine.addResource(st, 'A', 'y', -1);
  assert.ok(!r4.ok && /非负/.test(r4.error), '负库存应拒绝');
}

// 2. 引用不存在的资源：拒绝并给出涉及链条
{
  const st = freshSample();
  Engine.addRecipe(st, '台账', { id: 'R-GHOST', output: { resource: '主机', qty: 1 }, inputs: [{ resource: '显卡', qty: 1 }] });
  const m = Engine.buildModel(st);
  assert.ok(m.recipes['R-GHOST'].invalid, '缺失引用的配方应被标记拒绝');
  const err = m.errors.find(e => /显卡/.test(e));
  assert.ok(err && /R-GHOST/.test(err) && /链条/.test(err) && /主机/.test(err), '错误应含涉及链条: ' + err);
}

// 3. 循环依赖：整环拒绝并给出环链
{
  const st = freshSample();
  Engine.addRecipe(st, '台账', { id: 'R-RETRO', output: { resource: '芯片', qty: 1 }, inputs: [{ resource: '电路板', qty: 1 }] });
  const m = Engine.buildModel(st);
  const err = m.errors.find(e => /循环依赖/.test(e));
  assert.ok(err && /R-BOARD/.test(err) && /R-RETRO/.test(err), '环链应列出涉及配方: ' + err);
  assert.ok(!m.valid['R-BOARD'] && !m.valid['R-RETRO'], '成环配方应被排除');
}

// 4. 逐级推演：需求、缺口、放大倍数、断供根源，缺口不当作已满足
{
  const st = freshSample();
  const v = Engine.getView(st);
  assert.strictEqual(rowOf(v, '套件').req, 120);
  assert.strictEqual(rowOf(v, '主机').req, 120);
  assert.strictEqual(rowOf(v, '电路板').req, 110);
  assert.strictEqual(rowOf(v, '芯片').req, 120);
  assert.strictEqual(rowOf(v, '螺丝').req, 440);
  assert.ok(Math.abs(rowOf(v, '芯片').shortage - 20) < 1e-9, '芯片缺口 20');
  assert.ok(Math.abs(rowOf(v, '电路板').shortage - 10) < 1e-9, '电路板缺口 10');
  assert.ok(Math.abs(rowOf(v, '主机').shortage - 30) < 1e-9, '主机缺口 30');
  assert.ok(Math.abs(rowOf(v, '套件').produced - 90) < 1e-9, '套件只能产出 90，缺口不得视为已满足');
  assert.deepStrictEqual(v.rootCauses.slice().sort(), ['外壳', '芯片'], '断供根源');
  assert.strictEqual(v.firstShortLevel, 0, '缺口最早出现层级');
  assert.ok(Math.abs(rowOf(v, '芯片').cumMult - 1) < 1e-9, '放大倍数=需求/目标');
  const src = rowOf(v, '芯片').consumers[0];
  assert.ok(src && src.recipe === 'R-BOARD' && Math.abs(src.edgeMult - 2) < 1e-9, '缺口来源与单件放大');
}
// 5. 冲突：双方保留、生成可读记录、不静默择一
{
  const st = freshSample();
  Engine.loadDataset(st, '采购', { resources: [{ id: '芯片', stock: 140 }], recipes: [] });
  let m = Engine.buildModel(st);
  const c = m.conflicts.find(x => x.kind === 'resource-stock' && x.id === '芯片');
  assert.ok(c && c.values.length === 2 && c.tentative, '冲突应保留双方并标记临时取值');
  assert.strictEqual(m.resources['芯片'].stock, 100, '未裁决时临时取最小值');
  Engine.resolveConflict(st, 'resource-stock', '芯片', 140);
  m = Engine.buildModel(st);
  assert.strictEqual(m.resources['芯片'].stock, 140, '人工裁决后采用所选值');
  assert.ok(!m.conflicts.find(x => x.id === '芯片').tentative, '裁决后不再是临时取值');
  // 配方定义冲突：裁决后增量重推与全量一致，且投入需求按新变体计算
  Engine.loadDataset(st, '采购', { resources: [], recipes: [
    { id: 'R-ASSY', output: { resource: '主机', qty: 1 }, inputs: [
      { resource: '电路板', qty: 1 }, { resource: '外壳', qty: 1 }, { resource: '螺丝', qty: 6 }] }
  ] });
  Engine.runRecompute(st, null, '全量');
  const rc = Engine.resolveConflict(st, 'recipe-def', 'R-ASSY', 1);
  assert.ok(rc.ok, '配方冲突裁决应成功');
  const v2 = Engine.getView(st);
  assert.ok(v2.meta.consistent, '配方裁决后增量=全量');
  assert.strictEqual(rowOf(v2, '螺丝').req, 660, '螺丝需求应按新变体 6 件计算');
}

// 6. 库存修正 / 配方停用：增量重推与全量一致
{
  const st = freshSample();
  Engine.setStock(st, '芯片', 200);
  let v = Engine.getView(st);
  assert.ok(v.meta.consistent, '库存修正后增量=全量');
  assert.ok(Math.abs(rowOf(v, '芯片').shortage - 0) < 1e-9, '芯片补足后无缺口');
  Engine.setRecipeEnabled(st, 'R-BOARD', false);
  v = Engine.getView(st);
  assert.ok(v.meta.consistent, '停用配方后增量=全量');
  assert.ok(Math.abs(rowOf(v, '电路板').shortage - 60) < 1e-9, '停用后电路板缺 60');
  Engine.setRecipeEnabled(st, 'R-BOARD', true);
  v = Engine.getView(st);
  assert.ok(v.meta.consistent, '恢复启用后增量=全量');
}

// 7. 随机模糊测试：任意操作序列下增量重推 == 从头全量重推
{
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let t = 0; t < 40; t++) {
    const s = Engine.createState();
    const nres = 6 + Math.floor(rnd() * 6);
    const ids = [];
    for (let i = 0; i < nres; i++) { ids.push('r' + i); Engine.addResource(s, 'S', 'r' + i, Math.floor(rnd() * 50)); }
    for (let i = 1; i < nres; i++) {
      if (rnd() < 0.75) {
        const inputs = [];
        const k = 1 + Math.floor(rnd() * 2);
        for (let j = 0; j < k; j++) {
          const inp = 'r' + (i + Math.floor(rnd() * (nres - i)));
          if (inp !== 'r' + i && !inputs.some(x => x.resource === inp)) {
            inputs.push({ resource: inp, qty: 1 + Math.floor(rnd() * 3) });
          }
        }
        if (inputs.length) Engine.addRecipe(s, 'S', { id: 'p' + i, output: { resource: 'r' + i, qty: 1 }, inputs });
      }
    }
    Engine.setTarget(s, 'r0', 10 + Math.floor(rnd() * 40));
    for (let op = 0; op < 10; op++) {
      const id = ids[Math.floor(rnd() * nres)];
      if (rnd() < 0.5) Engine.setStock(s, id, Math.floor(rnd() * 60));
      else Engine.setRecipeEnabled(s, 'p' + (1 + Math.floor(rnd() * (nres - 1))), rnd() < 0.5);
    }
    const v = Engine.getView(s);
    assert.ok(v.meta.consistent, '模糊用例 ' + t + ' 增量与全量不一致');
  }
}

console.log('全部测试通过 ✓');
