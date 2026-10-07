import {
  createInitialState,
  addIngredient,
  addGrind,
  createIncense,
  placeIncenseOnCenser,
  ignite,
  tick,
  reset as machineReset,
  checkInvariants,
  totalGrams,
  MAX_TOTAL_GRAMS,
  MAX_ITEM_GRAMS,
  GRIND_FULL,
  BURN_TICKS,
  type IncenseState,
  type MachineContext,
  type StepResult,
} from '../src/incense/machine.ts';
import { INGREDIENTS } from '../src/types/index.ts';
import { mixColors } from '../src/utils/color.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
let checks = 0;

function ctxFor(seed: number): MachineContext {
  let id = 0;
  return { now: 0, random: mulberry32(seed), nextParticleId: () => id++ };
}

function expectOk(label: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    console.log(`    ✓ ${label}`);
  } else {
    failures++;
    console.log(`    ✗ ${label}${detail ? ` —— ${detail}` : ''}`);
  }
}

function expectReject(prev: IncenseState, step: StepResult, reason: string, label: string) {
  expectOk(
    `${label} 被拒绝且状态不变（原因 ${reason}）`,
    !step.accepted && step.rejected === reason && step.state === prev,
    `accepted=${step.accepted}, rejected=${step.rejected}`,
  );
}

function runStep(
  scenario: string,
  index: number,
  action: string,
  result: StepResult,
): IncenseState {
  const state = result.state;
  const violations = checkInvariants(state);
  const tag = `[${scenario}] 第${index}步「${action}」`;
  if (violations.length === 0) {
    console.log(`  ${tag}: 通过（阶段=${state.phase}）`);
  } else {
    failures += violations.length;
    for (const v of violations) {
      console.log(`  ${tag}: ✗ 不一致【${v.code}】${v.detail}`);
    }
  }
  checks++;
  return state;
}

function gramOf(state: IncenseState, name: string): number {
  return state.currentRecipe.find(item => item.name === name)?.grams ?? 0;
}

const A = INGREDIENTS[0];
const B = INGREDIENTS[1];
const C = INGREDIENTS[2];

function add(state: IncenseState, ing: typeof A, grams = 1) {
  return addIngredient(state, ing.name, grams, ing.color);
}
function grindFull(state: IncenseState) {
  let s = state;
  while (s.grindLevel < GRIND_FULL) {
    s = addGrind(s, 10).state;
  }
  return s;
}
function burnFor(state: IncenseState, ticks: number, seed = 42) {
  const ctx = ctxFor(seed);
  let s = state;
  for (let i = 0; i < ticks; i++) {
    const r = tick(s, ctx);
    if (!r.accepted) return r;
    s = r.state;
  }
  return { state: s, accepted: true } as StepResult;
}

function scenario1() {
  console.log('\n场景一：重复加料（同一香料连点 12 次）');
  let state = createInitialState();
  let result: StepResult;
  for (let i = 1; i <= 12; i++) {
    result = add(state, A);
    state = runStep('重复加料', i, `第${i}次点击${A.name}`, result);
    if (i > MAX_ITEM_GRAMS) {
      expectOk(`第${i}次点击为无效触发（单料上限 ${MAX_ITEM_GRAMS}g）`, !result.accepted);
      expectOk('克数不回退、不超限', gramOf(state, A.name) === MAX_ITEM_GRAMS);
    }
  }
  expectOk('总重不超过 10g', totalGrams(state.currentRecipe) === MAX_ITEM_GRAMS);
}

function scenario2() {
  console.log('\n场景二：超限加料（冲单料上限与总重上限）');
  let state = createInitialState();
  let r = add(state, A, 8);
  state = runStep('超限加料', 1, '一次添加 8g（单料上限 5g）', r);
  expectOk('单料被夹到 5g', gramOf(state, A.name) === MAX_ITEM_GRAMS);

  r = add(state, B, 6);
  state = runStep('超限加料', 2, '再添加 6g（仅剩 5g 总重空间）', r);
  expectOk('总重被夹到 10g', totalGrams(state.currentRecipe) === MAX_TOTAL_GRAMS);
  expectOk('乳香被夹到 5g', gramOf(state, B.name) === MAX_ITEM_GRAMS);

  const fullPrev = state;
  r = add(state, C, 3);
  state = runStep('超限加料', 3, '总重已满仍添加没药', r);
  expectReject(fullPrev, r, 'TOTAL_CAP_REACHED', '满重后加料');
  expectOk('没药未进入配方', gramOf(state, C.name) === 0);
  expectOk('总重仍为 10g（无溢出）', totalGrams(state.currentRecipe) === MAX_TOTAL_GRAMS);
  expectOk('已有单料克数未被回退', gramOf(state, A.name) === 5 && gramOf(state, B.name) === 5);
}

function scenario3() {
  console.log('\n场景三：合成后继续加料');
  let state = grindFull(add(createInitialState(), A, 4).state);
  const r = add(state, B, 3);
  state = runStep('合成后继续加料', 1, '研磨满后添加乳香 3g', r);
  state = grindFull(state);
  const colorBefore = mixColors([
    { color: A.color, weight: 4 },
    { color: B.color, weight: 3 },
  ]);

  const synth = createIncense(state);
  state = runStep('合成后继续加料', 2, '合香', synth);
  expectOk('香品颜色由合成时配方快照决定', state.incense?.color === colorBefore);
  expectOk('合成后配方槽清空、研磨归零', state.currentRecipe.length === 0 && state.grindLevel === 0);

  const synthPrev = state;
  const addAfter = add(state, C, 2);
  state = runStep('合成后继续加料', 3, '合香后再添加没药 2g', addAfter);
  expectReject(synthPrev, addAfter, 'LOCKED_INGREDIENT', '合成后加料');
  expectOk('配方槽仍为空', state.currentRecipe.length === 0);
  expectOk('香炉香品颜色不随后续操作改变', state.incense?.color === colorBefore);

  const grindAfter = addGrind(state, 10);
  expectReject(synthPrev, grindAfter, 'NEED_RECIPE', '合成后研磨');
  expectOk('研磨度仍为 0（无残留值起算）', state.grindLevel === 0);

  const place = placeIncenseOnCenser(state);
  state = runStep('合成后继续加料', 4, '放置到香炉', place);
  const placedPrev = state;
  const addPlaced = add(state, A, 1);
  state = runStep('合成后继续加料', 5, '放置后仍尝试加料', addPlaced);
  expectReject(placedPrev, addPlaced, 'LOCKED_INGREDIENT', '放置后加料');
  expectOk('放置后香炉颜色仍等于快照颜色', state.incense?.color === colorBefore);
}

function scenario4() {
  console.log('\n场景四：放置后再合成（及其他越序/重复触发）');
  let state = grindFull(add(createInitialState(), A, 3).state);
  state = createIncense(state).state;
  state = placeIncenseOnCenser(state).state;

  const onCenserPrev = state;
  const synthAgain = createIncense(state);
  state = runStep('放置后再合成', 1, '放置后再次点击合香', synthAgain);
  expectReject(onCenserPrev, synthAgain, 'NO_INCENSE', '放置后合香');

  const placeAgain = placeIncenseOnCenser(state);
  state = runStep('放置后再合成', 2, '重复放置', placeAgain);
  expectReject(onCenserPrev, placeAgain, 'ALREADY_PLACED', '重复放置');

  const ignite1 = ignite(state);
  state = runStep('放置后再合成', 3, '点燃', ignite1);
  const burningPrev = state;
  const ignite2 = ignite(state);
  state = runStep('放置后再合成', 4, '燃烧中重复点燃', ignite2);
  expectReject(burningPrev, ignite2, 'ALREADY_BURNING', '重复点燃');
  expectOk('计时未因重复点燃重置', state.burntime === 0);
}

function scenario5() {
  console.log('\n场景五：燃烧中重置（计时/粒子/评分同时清零，可重新开一局）');
  let state = grindFull(add(createInitialState(), A, 3).state);
  state = createIncense(state).state;
  state = placeIncenseOnCenser(state).state;
  state = ignite(state).state;
  const burned = burnFor(state, 20, 7);
  state = runStep('燃烧中重置', 1, '燃烧 20 个 tick', burned);
  expectOk('燃烧中确有粒子产出', state.smokeParticles.length > 0);
  expectOk('计时与评分已推进', state.burntime === 20 && state.aromaScore === 4);

  state = machineReset();
  const violations = checkInvariants(state);
  checks++;
  if (violations.length === 0) {
    console.log('  [燃烧中重置] 第2步「重置」: 通过（阶段=mixing）');
  } else {
    failures += violations.length;
    violations.forEach(v => console.log(`  [燃烧中重置] 第2步「重置」: ✗ 【${v.code}】${v.detail}`));
  }
  expectOk('粒子全部清空', state.smokeParticles.length === 0);
  expectOk('计时归零', state.burntime === 0);
  expectOk('香气评分归零', state.aromaScore === 0);
  expectOk('无香品残留、香炉为空', state.incense === null && state.phase === 'mixing');

  const tickAfterReset = tick(state, ctxFor(1));
  expectReject(state, tickAfterReset, 'NOT_BURNING', '重置后 tick');

  state = add(state, B, 5).state;
  state = grindFull(state);
  state = createIncense(state).state;
  state = placeIncenseOnCenser(state).state;
  state = ignite(state).state;
  const reBurn = burnFor(state, BURN_TICKS + 40, 99);
  state = runStep('燃烧中重置', 3, '新一局完整燃烧至燃尽', reBurn);
  expectOk('燃尽后阶段为 burnt', state.phase === 'burnt');
  expectOk('燃尽后粒子清空', state.smokeParticles.length === 0);
  expectOk('燃尽时计时停在上限', state.burntime === BURN_TICKS);
  const tickAfterBurn = tick(state, ctxFor(3));
  expectReject(state, tickAfterBurn, 'NOT_BURNING', '燃尽后 tick');
}

function scenario6() {
  console.log('\n场景六：未研磨满 / 空配方等非法合成');
  let state = createInitialState();
  let r = createIncense(state);
  expectReject(state, r, 'NEED_RECIPE', '空配方合香');
  r = add(state, A, 2);
  state = r.state;
  r = createIncense(state);
  expectReject(state, r, 'GRIND_NOT_FULL', '研磨未满合香');
  r = placeIncenseOnCenser(state);
  expectReject(state, r, 'NO_INCENSE', '无香品时放置');
  r = ignite(state);
  expectReject(state, r, 'NO_INCENSE', '无香品时点燃');
  const t = tick(state, ctxFor(5));
  expectReject(state, t, 'NOT_BURNING', '未点燃时 tick');
}

scenario1();
scenario2();
scenario3();
scenario4();
scenario5();
scenario6();

console.log(`\n共 ${checks} 项检查，${failures} 项不一致`);
if (failures > 0) {
  console.log('验证失败：存在状态不一致');
  process.exit(1);
}
console.log('验证通过：加料→研磨→合成→放置→点燃→重置 全链路一致');
