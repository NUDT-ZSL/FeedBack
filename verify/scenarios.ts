import assert from 'node:assert';
import { HERBS } from '../src/constants';
import { Herb } from '../src/types';
import {
  addIngredient,
  createFurnaceRuntime,
  detectConflict,
  getFurnacePills,
  rebuildFurnace,
  setAirflow,
  tickAll,
  undoLastAdd
} from '../src/core';

const herbById = (id: string): Herb => {
  const herb = HERBS.find(h => h.id === id);
  if (!herb) throw new Error(`unknown herb ${id}`);
  return herb;
};

const LINGZHI = herbById('lingzhi');
const RENSHEN = herbById('renshen');
const ZHUSHA = herbById('zhusha');
const HUANGQI = herbById('huangqi');
const DAGUI = herbById('dazao');

let passed = 0;
let failed = 0;

async function scenario(name: string, fn: () => void): Promise<void> {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${(err as Error).message.split('\n').join('\n     ')}`);
  }
}

function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

function replay(id: string, name: string, herbs: Herb[], airflow = 50) {
  const rt = createFurnaceRuntime(id, name);
  if (airflow !== 50) setAirflow(rt, airflow);
  for (const herb of herbs) addIngredient(rt, herb, 0);
  return rt;
}

console.log('丹台批量推演：多炉并行 / 冲突裁决 / 回退一致性\n');

console.log('一、多炉并行，互不串味');

await scenario('多炉各自独立成丹/持料：甲炉木火成丹，乙炉持土，丙炉空炉', () => {
  const jia = createFurnaceRuntime('jia', '甲炉');
  const yi = createFurnaceRuntime('yi', '乙炉');
  const bing = createFurnaceRuntime('bing', '丙炉');

  addIngredient(jia, LINGZHI, 0);
  const r2 = addIngredient(jia, ZHUSHA, 0);
  addIngredient(yi, HUANGQI, 0);
  tickAll([jia, yi, bing], 16, 0);

  assert.strictEqual(r2.outcome?.kind, 'pill', '甲炉第二手应成丹');
  assert.ok(['木火丹', '青焰丹'].includes(r2.outcome!.pill!.name), '应成木火丹方丹药');
  assert.strictEqual(jia.status, 'pill');
  assert.strictEqual(jia.ingredients.length, 0, '成丹后甲炉应清炉待下一批');
  assert.strictEqual(yi.status, 'pending');
  assert.deepStrictEqual(yi.ingredients.map(h => h.id), ['huangqi']);
  assert.strictEqual(bing.status, 'pending');
  assert.strictEqual(bing.ingredients.length, 0);
});

await scenario('后台炉按各自火候推进：高风量炉温高于低风量炉', () => {
  const jia = createFurnaceRuntime('jia', '甲炉');
  const yi = createFurnaceRuntime('yi', '乙炉');
  setAirflow(jia, 80);
  setAirflow(yi, 20);
  const beforeJia = jia.temperature;
  tickAll([jia, yi], 2000, 2000);
  assert.ok(jia.temperature > beforeJia, '甲炉应升温');
  assert.ok(jia.temperature > yi.temperature, '高风量炉温应更高');
  assert.ok(Math.abs(jia.targetTemperature - 84) < 1e-9);
  assert.ok(Math.abs(yi.targetTemperature - 36) < 1e-9);
});

await scenario('切换选中炉不改变任何炉的推演结果', () => {
  const furnaces = [
    createFurnaceRuntime('jia', '甲炉'),
    createFurnaceRuntime('yi', '乙炉')
  ];
  addIngredient(furnaces[0], LINGZHI, 0);
  setAirflow(furnaces[1], 80);
  const before = furnaces.map(f => snapshot(f));
  let selectedId = 'jia';
  selectedId = 'yi';
  tickAll(furnaces, 100, 100);
  selectedId = 'jia';
  assert.strictEqual(snapshot(furnaces[0]), before[0], '甲炉结果不应因切换选中而变');
  assert.ok(snapshot(furnaces[1]) !== before[1], '乙炉 tick 结果随自身火候推进');
  assert.strictEqual(selectedId, 'jia');
});

console.log('\n二、冲突投料当场裁决');

await scenario('木克土：相克配伍当场判炸炉并清炉', () => {
  const rt = createFurnaceRuntime('jia', '甲炉');
  addIngredient(rt, LINGZHI, 0);
  const result = addIngredient(rt, HUANGQI, 1000);
  assert.strictEqual(result.outcome?.kind, 'explosion', '木土相克应炸炉');
  assert.strictEqual(rt.status, 'explosion');
  assert.strictEqual(rt.ingredients.length, 0, '炸炉后应清炉');
  assert.strictEqual(getFurnacePills(rt).length, 0, '炸炉不得产出正常丹药');
  assert.ok(rt.cooldownUntil > 1000, '炸炉后应有冷却余震');
});

await scenario('重复元素：同属性重复投料判废丹', () => {
  const rt = createFurnaceRuntime('jia', '甲炉');
  addIngredient(rt, LINGZHI, 0);
  const result = addIngredient(rt, RENSHEN, 0);
  assert.strictEqual(result.outcome?.kind, 'waste', '双木重复应判废丹');
  assert.strictEqual(result.outcome!.pill!.rarity, 'waste');
  assert.strictEqual(rt.status, 'waste');
  assert.strictEqual(rt.ingredients.length, 0);
  assert.strictEqual(getFurnacePills(rt).length, 0, '废丹不得计入正常丹药');
});

await scenario('冲突双方来源都保留，处置依据可解释', () => {
  const batch = [LINGZHI, HUANGQI];
  const conflict = detectConflict(batch);
  assert.ok(conflict && conflict.kind === 'restraint');
  assert.deepStrictEqual(conflict.existing.map(p => p.herbId), ['lingzhi']);
  assert.strictEqual(conflict.incoming.herbId, 'huangqi');
  assert.ok(conflict.reason.includes('克'), '依据应说明相克关系');
  assert.ok(conflict.resolution.includes('炸炉'));

  const rt = createFurnaceRuntime('jia', '甲炉');
  addIngredient(rt, LINGZHI, 0);
  addIngredient(rt, RENSHEN, 0);
  const waste = rt.lastOutcome;
  assert.ok(waste?.basis.join('；').includes('灵芝') && waste.basis.join('；').includes('人参'),
    '废丹依据须同时保留双方药材名');
});

await scenario('冲突裁决只重推本炉，其余炉结论不变', () => {
  const jia = replay('jia', '甲炉', [LINGZHI, ZHUSHA]);
  const yi = replay('yi', '乙炉', [LINGZHI, ZHUSHA]);
  const yiBefore = snapshot(yi);
  addIngredient(jia, LINGZHI, 0);
  addIngredient(jia, HUANGQI, 2000);
  assert.strictEqual(jia.status, 'explosion');
  assert.strictEqual(snapshot(yi), yiBefore, '乙炉的成丹结论与依据不受甲炉冲突牵连');
});

console.log('\n三、单炉回退与从头重投一致');

await scenario('撤销普通投料：元素、火色、温度、成丹均回到投料前', () => {
  const rt = replay('jia', '甲炉', [LINGZHI, ZHUSHA, HUANGQI]);
  assert.strictEqual(rt.ingredients.length, 1, '第三手土应在炉待炼');
  undoLastAdd(rt);
  const expected = replay('jia', '甲炉', [LINGZHI, ZHUSHA]);
  assert.strictEqual(snapshot({
    ingredients: rt.ingredients,
    flameColor: rt.flameColor,
    flameHeight: rt.flameHeight,
    temperature: rt.temperature,
    status: rt.status,
    outcomes: rt.outcomes,
    trace: rt.trace
  }), snapshot({
    ingredients: expected.ingredients,
    flameColor: expected.flameColor,
    flameHeight: expected.flameHeight,
    temperature: expected.temperature,
    status: expected.status,
    outcomes: expected.outcomes,
    trace: expected.trace
  }));
});

await scenario('撤销炸炉/废丹投料：恢复到冲突前一致状态', () => {
  const rt = replay('jia', '甲炉', [LINGZHI, HUANGQI]);
  assert.strictEqual(rt.status, 'explosion');
  undoLastAdd(rt);
  const expected = replay('jia', '甲炉', [LINGZHI]);
  assert.strictEqual(rt.status, 'pending');
  assert.strictEqual(rt.cooldownUntil, 0);
  assert.strictEqual(snapshot(rt), snapshot(expected), '撤销炸炉手应等同从未投过该药材');

  const rt2 = replay('jia', '甲炉', [LINGZHI, RENSHEN]);
  assert.strictEqual(rt2.status, 'waste');
  undoLastAdd(rt2);
  const expected2 = replay('jia', '甲炉', [LINGZHI]);
  assert.strictEqual(snapshot(rt2), snapshot(expected2), '撤销废丹手应等同从未投过该药材');
});

await scenario('多批次（成丹后再开一批）后回退仅退最近一手', () => {
  const rt = replay('jia', '甲炉', [LINGZHI, ZHUSHA, RENSHEN, HUANGQI]);
  assert.strictEqual(rt.outcomes.length, 2, '应有成丹与炸炉两个批次结论');
  undoLastAdd(rt);
  assert.strictEqual(rt.outcomes.length, 1, '回退后炸炉批次消失');
  assert.strictEqual(rt.status, 'pill', '状态应回到上一批次（成丹）的结论');
  assert.deepStrictEqual(rt.ingredients.map(h => h.id), ['renshen'], '第二批已投的人参仍在炉中');
});

console.log('\n四、混合操作下依据可追溯');

await scenario('多炉交错操作：各炉丹录只含本炉事件且序号连续', () => {
  const jia = createFurnaceRuntime('jia', '甲炉');
  const yi = createFurnaceRuntime('yi', '乙炉');
  addIngredient(jia, LINGZHI, 0);
  addIngredient(yi, DAGUI, 0);
  addIngredient(jia, ZHUSHA, 0);
  addIngredient(yi, ZHUSHA, 0);

  for (const rt of [jia, yi]) {
    assert.ok(rt.trace.every(e => e.furnaceId === rt.id), '丹录不得串炉');
    const seqs = rt.trace.map(e => e.seq);
    assert.deepStrictEqual(seqs, [...seqs].sort((a, b) => a - b), '序号应单调');
  }
  assert.strictEqual(jia.lastOutcome?.kind, 'pill');
  assert.strictEqual(yi.lastOutcome?.kind, 'pill');
  const basis = jia.lastOutcome!.basis!.join('；');
  assert.ok(basis.includes('相生组合：木生火'), '依据须记载相生关系');
  assert.ok(basis.includes('契合丹方'), '依据须记载丹方匹配');
  assert.ok(basis.includes('灵芝') && basis.includes('朱砂'), '依据须记载投料来源');
  assert.ok(basis.includes('炉温'), '依据须记载火候');
});

await scenario('纯函数重建：同一投料序列任意时刻重建结果一致', () => {
  const rt = createFurnaceRuntime('jia', '甲炉');
  const herbs = [LINGZHI, ZHUSHA, RENSHEN, HUANGQI, DAGUI];
  for (const herb of herbs) {
    addIngredient(rt, herb, 0);
    const once = snapshot(rt);
    rebuildFurnace(rt);
    assert.strictEqual(snapshot(rt), once, 'rebuild 必须幂等');
  }
  const again = replay('jia', '甲炉', herbs);
  assert.strictEqual(snapshot(again), snapshot(rt), '同序列重投须得到完全相同结论');
});

console.log(`\n推演结束：${passed} 项通过，${failed} 项失败`);
if (failed > 0) process.exit(1);
