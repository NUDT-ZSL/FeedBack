/**
 * 批量验证入口：一次性覆盖多炉并行、冲突裁决、单炉回退与混合操作可追溯。
 * 离线零依赖运行：node scripts/batch.ts（或 npm run batch）
 */
import { AlchemyWorkshop } from '../src/engine/workshop.ts';
import type { FurnaceState } from '../src/engine/model.ts';
import { HERBS } from '../src/constants.ts';
import type { Herb } from '../src/types.ts';

let passed = 0;
let failed = 0;
let currentScenario = '';

function scenario(name: string): void {
  currentScenario = name;
  console.log(`\n== ${name} ==`);
}

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${message}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${message}`);
    console.error(`    期望: ${b}`);
    console.error(`    实际: ${a}`);
  }
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function herb(id: string): Herb {
  const found = HERBS.find((item) => item.id === id);
  if (!found) throw new Error(`未知药材: ${id}`);
  return found;
}

function snapshot(furnace: FurnaceState): Record<string, unknown> {
  return {
    name: furnace.name,
    ingredients: furnace.ingredients.map((record) => [record.seq, record.herb.id]),
    elements: [...furnace.elements],
    airflow: furnace.airflow,
    temperature: furnace.temperature,
    flameColor: furnace.flameColor,
    flameHeight: furnace.flameHeight,
    status: furnace.status,
    activeConflicts: furnace.activeConflicts.map((conflict) => conflict.id),
    verdict: {
      outcome: furnace.verdict.outcome,
      reason: furnace.verdict.reason,
      basis: [...furnace.verdict.basis],
      pill: furnace.verdict.pill
        ? {
            id: furnace.verdict.pill.id,
            name: furnace.verdict.pill.name,
            elements: [...furnace.verdict.pill.elements],
            rarity: furnace.verdict.pill.rarity,
            effect: furnace.verdict.pill.effect,
            ingredients: [...furnace.verdict.pill.ingredients],
            fireTemp: furnace.verdict.pill.fireTemp,
            airFlow: furnace.verdict.pill.airFlow
          }
        : null
    }
  };
}

// ---------------------------------------------------------------- 场景一
scenario('场景一：多炉并行 —— 各炉独立推进、鼓风只作用选中炉、切换不串状态');
{
  const ws = new AlchemyWorkshop(mulberry32(1));
  const A = ws.addFurnace('甲炉');
  const B = ws.addFurnace('乙炉');
  const C = ws.addFurnace('丙炉');

  ws.addIngredient(A.id, herb('lingzhi'));
  ws.addIngredient(A.id, herb('zhusha'));
  ws.addIngredient(B.id, herb('huangqi'));

  ws.setAirflow(A.id, 90);
  ws.setAirflow(B.id, 10);
  ws.setAirflow(C.id, 50);

  for (let i = 0; i < 50; i++) ws.tick(100);

  assert(Math.abs(A.temperature - 92) < 1.5, `甲炉炉温按自身风量推进（${A.temperature.toFixed(1)} ≈ 92）`);
  assert(Math.abs(B.temperature - 28) < 1.5, `乙炉炉温按自身风量推进（${B.temperature.toFixed(1)} ≈ 28）`);
  assert(Math.abs(C.temperature - 60) < 1.5, `丙炉炉温按自身风量推进（${C.temperature.toFixed(1)} ≈ 60）`);
  assertDeepEqual(A.elements, ['wood', 'fire'], '甲炉元素集合独立（木、火）');
  assertDeepEqual(B.elements, ['earth'], '乙炉元素集合独立（土）');
  assertDeepEqual(C.elements, [], '丙炉未投料，元素为空');
  assert(A.verdict.outcome === 'pill', '甲炉木火相生，独立成丹');
  assert(B.verdict.outcome === 'none', '乙炉孤药不成丹，互不牵连');

  ws.selectFurnace(B.id);
  ws.setAirflow(ws.getSelectedId()!, 77);
  assert(B.airflow === 77, '鼓风作用于当前选中的乙炉');
  assert(A.airflow === 90 && C.airflow === 50, '未选中炉风量不受影响');

  const beforeSwitch = snapshot(ws.getFurnace(A.id));
  ws.selectFurnace(A.id);
  ws.selectFurnace(C.id);
  ws.selectFurnace(B.id);
  assertDeepEqual(snapshot(ws.getFurnace(A.id)), beforeSwitch, '反复切换选中炉不改动任何炉状态');
  assert(ws.getSelectedId() === B.id, '选中炉跟随最近一次切换');

  const tempBefore = C.temperature;
  ws.selectFurnace(A.id);
  for (let i = 0; i < 10; i++) ws.tick(100);
  assert(Math.abs(ws.getFurnace(C.id).temperature - tempBefore) < 1, '未选中的丙炉在后台继续按自身火候推进');
}

// ---------------------------------------------------------------- 场景二
scenario('场景二：冲突裁决 —— 相克炸炉、重复废丹、来源保留、他炉无牵连');
{
  const ws = new AlchemyWorkshop(mulberry32(2));
  const A = ws.addFurnace('甲炉');
  ws.addIngredient(A.id, herb('lingzhi'));
  const restrainResult = ws.addIngredient(A.id, herb('huangqi'));

  assert(restrainResult.conflicts.length === 1, '投料当下即识别出相克冲突');
  const restrain = restrainResult.conflicts[0];
  assert(restrain.kind === 'restrain' && restrain.resolution === 'explode', '木克土裁决为炸炉');
  assert(
    restrain.existing.herb.name === '灵芝' && restrain.incoming.herb.name === '黄芪',
    '冲突双方来源均保留（灵芝 × 黄芪）'
  );
  assert(restrain.reason.includes('克'), `处置结论可解释：${restrain.reason}`);
  assert(A.status === 'exploded' && A.verdict.outcome === 'explode', '甲炉进入炸炉状态，不予成丹');
  assert(A.verdict.basis.length >= 1, '炸炉判定附可追溯依据');

  const B = ws.addFurnace('乙炉');
  ws.addIngredient(B.id, herb('lingzhi'));
  const duplicateResult = ws.addIngredient(B.id, herb('renshen'));
  assert(duplicateResult.conflicts.length === 1, '投料当下即识别出重复冲突');
  const duplicate = duplicateResult.conflicts[0];
  assert(duplicate.kind === 'duplicate' && duplicate.resolution === 'waste', '重复木性裁决为废丹');
  assert(
    duplicate.existing.herb.name === '灵芝' && duplicate.incoming.herb.name === '人参',
    '重复冲突双方来源均保留（灵芝 × 人参）'
  );
  assert(B.status === 'conflicted' && B.verdict.outcome === 'waste', '乙炉判为废丹而非正常丹药');

  const C = ws.addFurnace('丙炉');
  ws.addIngredient(C.id, herb('lingzhi'));
  const pillResult = ws.addIngredient(C.id, herb('zhusha'));
  assert(pillResult.verdict.outcome === 'pill', '丙炉正常成丹，不受甲乙两炉冲突牵连');
  assert(ws.getFurnace(A.id).status === 'exploded', '甲炉炸炉状态不被他炉操作改写');
  assert(ws.getFurnace(B.id).status === 'conflicted', '乙炉废丹状态不被他炉操作改写');
}

// ---------------------------------------------------------------- 场景三
scenario('场景三：单炉回退 —— 撤销投料后状态复原，且与从头重投一致');
{
  const seed = 7;
  const ws1 = new AlchemyWorkshop(mulberry32(seed));
  const A = ws1.addFurnace('甲炉');
  ws1.addIngredient(A.id, herb('lingzhi'));
  ws1.setAirflow(A.id, 66);
  ws1.tick(250);
  ws1.addIngredient(A.id, herb('zhusha'));
  ws1.tick(250);

  const beforeAdd = snapshot(ws1.getFurnace(A.id));

  ws1.addIngredient(A.id, herb('huangqi'));
  assert(ws1.getFurnace(A.id).status === 'exploded', '第三味黄芪引发木克土炸炉');

  const undoResult = ws1.undoLastIngredient(A.id);
  assert(undoResult.removed?.herb.id === 'huangqi', '回退撤销的是最近一次投料（黄芪）');
  assertDeepEqual(snapshot(ws1.getFurnace(A.id)), beforeAdd, '回退后元素/火焰/温度/判定恢复投料前状态');

  const ws2 = new AlchemyWorkshop(mulberry32(seed));
  const B = ws2.addFurnace('甲炉');
  ws2.addIngredient(B.id, herb('lingzhi'));
  ws2.setAirflow(B.id, 66);
  ws2.tick(250);
  ws2.addIngredient(B.id, herb('zhusha'));
  ws2.tick(250);
  assertDeepEqual(snapshot(ws2.getFurnace(B.id)), beforeAdd, '回退结果与从头重投同样药材完全一致');

  const ws3 = new AlchemyWorkshop(mulberry32(3));
  const E = ws3.addFurnace('戊炉');
  assert(ws3.undoLastIngredient(E.id).removed === null, '空炉回退安全返回，不报错');
}

// ---------------------------------------------------------------- 场景四
scenario('场景四：混合操作 —— 切换/并行/冲突/回退交织下结论与依据可追溯');
{
  const ws = new AlchemyWorkshop(mulberry32(9));
  const A = ws.addFurnace('甲炉');
  const B = ws.addFurnace('乙炉');

  ws.addIngredient(A.id, herb('lingzhi'));
  ws.selectFurnace(B.id);
  ws.addIngredient(B.id, herb('zhusha'));
  ws.tick(300);
  ws.addIngredient(A.id, herb('huangqi'));
  ws.setAirflow(B.id, 80);
  ws.addIngredient(B.id, herb('gouqi'));
  ws.undoLastIngredient(A.id);
  ws.tick(300);

  const furnaceA = ws.getFurnace(A.id);
  const furnaceB = ws.getFurnace(B.id);

  const seqs = furnaceA.log.map((event) => event.seq);
  const ordered = seqs.every((seq, index) => seq === index + 1);
  assert(ordered, '甲炉日志序号连续有序，全程可追溯');
  assert(
    furnaceA.log.some((event) => event.type === 'conflict') &&
      furnaceA.log.some((event) => event.type === 'undo'),
    '甲炉日志同时记录冲突与回退操作'
  );
  assert(
    furnaceA.conflictHistory.length === 1 && furnaceA.conflictHistory[0].active === false,
    '回退后冲突备案保留但标记为已解除'
  );
  assert(furnaceA.verdict.outcome === 'none', '甲炉回退后仅剩孤药，结论为未成丹');
  assert(
    !furnaceA.log.some((event) => event.message.includes('朱砂') || event.message.includes('枸杞')),
    '甲炉日志不混入乙炉的投料记录'
  );

  assert(furnaceB.verdict.outcome === 'pill', '乙炉木火相生正常成丹');
  assert(
    furnaceB.verdict.basis.some((line) => line.includes('相生判定')) &&
      furnaceB.verdict.basis.some((line) => line.includes('火候记录')),
    '乙炉成丹依据含相生判定与火候记录'
  );
  assert(
    furnaceB.verdict.pill !== null && furnaceB.verdict.pill.ingredients.length === 2,
    '乙炉丹药保留完整药材来源'
  );
}

// ---------------------------------------------------------------- 汇总
console.log(`\n========================================`);
console.log(`批量验证完成：${passed} 项通过，${failed} 项失败`);
if (failed > 0) {
  console.error('存在未通过项，请检查上方 ✗ 标记。');
  process.exit(1);
}
console.log('全部路径验证通过。');
