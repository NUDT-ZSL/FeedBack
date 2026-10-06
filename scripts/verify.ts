/**
 * 调香坊状态机离线验证脚本
 *
 * 运行方式：npm run verify
 * （等价于 node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/verify.ts）
 *
 * 每个场景按步骤断言，失败时会打印出具体是哪一步产生了不一致。
 */
import {
  addIngredient,
  setGrind,
  createIncense,
  placeIncenseOnCenser,
  ignite,
  tick,
  reset,
  initialState,
  totalGrams,
  MAX_ITEM_GRAMS,
  MAX_TOTAL_GRAMS,
  BURN_DURATION_TICKS,
  DEFAULT_INCENSE_COLOR,
  type WorkshopState,
} from '../src/state/machine.ts';
import { mixColors } from '../src/utils/color.ts';
import { INGREDIENTS } from '../src/types/index.ts';

let failures = 0;
let checks = 0;
let currentScenario = '';

function scenario(name: string) {
  currentScenario = name;
  console.log(`\n■ ${name}`);
}

function check(step: string, condition: boolean, detail: string) {
  checks++;
  if (condition) {
    console.log(`  ✓ ${step}`);
  } else {
    failures++;
    console.error(`  ✗ ${step}\n      不一致: ${detail}`);
  }
}

function eq(step: string, actual: unknown, expected: unknown) {
  check(
    step,
    Object.is(actual, expected),
    `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
  );
}

const AMBER = INGREDIENTS[0]; // 龙涎香
const OLIB = INGREDIENTS[1]; // 乳香
const MYRRH = INGREDIENTS[2]; // 没药

const add = (s: WorkshopState, ing = AMBER, grams = 1) =>
  addIngredient(s, ing.name, grams, ing.color);

// ---------------------------------------------------------------------------
scenario('场景一：重复加料（幂等、单调、单料上限）');
{
  let s = initialState();
  let prev = 0;
  let monotonic = true;
  let neverExceeded = true;
  for (let i = 0; i < 8; i++) {
    s = add(s);
    const g = s.currentRecipe.find(item => item.name === AMBER.name)?.grams ?? -1;
    if (g < prev) monotonic = false;
    if (g > MAX_ITEM_GRAMS) neverExceeded = false;
    prev = g;
  }
  check('连续点击 8 次过程中克数只增不减（无回退）', monotonic, `过程出现回退，终值 ${prev}`);
  check('连续点击 8 次过程中未超过单料上限', neverExceeded, `过程超过 ${MAX_ITEM_GRAMS}g`);
  eq('单料最终停在 5g 上限', prev, MAX_ITEM_GRAMS);
  eq('总重等于单料克数', totalGrams(s.currentRecipe), MAX_ITEM_GRAMS);
}

// ---------------------------------------------------------------------------
scenario('场景二：超限加料（总量上限 10g、超大单次加料）');
{
  let s = initialState();
  for (let i = 0; i < 8; i++) s = add(s, AMBER);
  for (let i = 0; i < 8; i++) s = add(s, OLIB);
  eq('两种香料各加满后总重为 10g', totalGrams(s.currentRecipe), MAX_TOTAL_GRAMS);

  const before = s;
  s = add(s, MYRRH);
  check('总重已满时加入第三种香料被拒绝', s === before, '配方被修改，出现第三种香料或总重超限');
  eq('拒绝后配方条目数仍为 2', s.currentRecipe.length, 2);

  s = add(s, AMBER);
  check('总重已满时继续加已有香料为空操作', s === before, '已有香料克数发生变化');

  let s2 = initialState();
  s2 = add(s2, AMBER, 100);
  eq('单次加 100g 被钳制到单料上限 5g', s2.currentRecipe[0]?.grams, MAX_ITEM_GRAMS);

  let s3 = initialState();
  s3 = add(s3, AMBER, 4);
  s3 = add(s3, OLIB, 4);
  s3 = add(s3, MYRRH, 4); // 只剩 2g 空间
  eq('总重剩余 2g 时加 4g 只入 2g', s3.currentRecipe.find(i => i.name === MYRRH.name)?.grams, 2);
  eq('部分入料后总重恰好 10g', totalGrams(s3.currentRecipe), MAX_TOTAL_GRAMS);
}

// ---------------------------------------------------------------------------
scenario('场景三：研磨与合成（进度真正归零、合成后拒绝加料）');
{
  let s = initialState();
  s = add(s, AMBER, 3);
  s = add(s, MYRRH, 2);

  const early = createIncense(s);
  check('研磨未满时合香为空操作', early === s, '研磨不足 100% 却生成了香品');

  s = setGrind(s, 120);
  eq('研磨进度被钳制在 100', s.grindLevel, 100);

  const expectedColor = mixColors([
    { color: AMBER.color, weight: 3 },
    { color: MYRRH.color, weight: 2 },
  ]);
  s = createIncense(s);
  eq('合成后持有香品', s.hasIncense, true);
  eq('香品颜色为配方加权混合色', s.incenseColor, expectedColor);
  eq('合成后研磨进度归零', s.grindLevel, 0);
  eq('合成后配方槽被消耗清空', s.currentRecipe.length, 0);

  const afterCreate = s;
  s = add(s, OLIB);
  check('合成后继续加料被拒绝', s === afterCreate, '香品已存在时配方槽仍被修改');
  s = setGrind(s, 50);
  eq('合成后研磨进度不会从残留值起算', s.grindLevel, 0);
  s = createIncense(s);
  check('重复合香为幂等空操作', s === afterCreate, '已有香品时再次合成改变了状态');
}

// ---------------------------------------------------------------------------
scenario('场景四：放置后再合成/加料（香炉上的香品不被改写）');
{
  let s = initialState();
  s = add(s, AMBER, 5);
  s = setGrind(s, 100);
  s = createIncense(s);
  const colorOnCenser = s.incenseColor;

  s = placeIncenseOnCenser(s);
  eq('香品放置到香炉', s.incenseOnCenser, true);

  const placed = placeIncenseOnCenser(s);
  check('重复放置为幂等空操作', placed === s, '重复放置改变了状态');

  s = add(s, MYRRH, 3);
  check('放置后加料被拒绝', s.currentRecipe.length === 0, '香炉有香品时配方槽仍被修改');
  eq('放置后加料不改变香品颜色', s.incenseColor, colorOnCenser);

  s = createIncense(s);
  check('放置后再合成为空操作', s.incenseColor === colorOnCenser && s.incenseOnCenser,
    '放置后再次合成改写了香炉上的香品');
}

// ---------------------------------------------------------------------------
scenario('场景五：燃烧推进与燃烧中重置（计时/烟雾/评分同步清零）');
{
  let s = initialState();
  s = add(s, AMBER, 5);
  s = setGrind(s, 100);
  s = createIncense(s);
  s = placeIncenseOnCenser(s);

  const notReady = ignite(initialState());
  check('未放置香品时点燃为空操作', notReady.isBurning === false, '空香炉被点燃');

  s = ignite(s);
  eq('点燃后进入燃烧态', s.isBurning, true);
  eq('点燃瞬间计时归零', s.burntime, 0);
  eq('点燃瞬间评分归零', s.aromaScore, 0);
  eq('点燃瞬间无残留烟雾', s.smokeParticles.length, 0);

  const reignite = ignite(s);
  check('燃烧中重复点燃为幂等空操作', reignite === s, '重复点燃重置了计时或评分');

  let now = 1_000_000;
  const fixedRandom = () => 0.5;
  for (let i = 0; i < 10; i++) {
    now += 100;
    s = tick(s, now, fixedRandom);
  }
  eq('推进 10 拍后计时为 10', s.burntime, 10);
  check('燃烧中产生烟雾粒子', s.smokeParticles.length > 0, '燃烧 10 拍后无任何烟雾粒子');
  eq('推进 10 拍后评分为 2', s.aromaScore, 2);
  check(
    '烟雾粒子颜色与香品颜色一致',
    s.smokeParticles.every(p => p.color === s.incenseColor),
    '存在与香品颜色不一致的粒子',
  );

  const resetState = reset();
  const init = initialState();
  check(
    '燃烧中重置后全部状态回到初始值',
    JSON.stringify(resetState) === JSON.stringify(init),
    `重置残留: ${JSON.stringify(resetState)}`,
  );
  check('重置后再次重置幂等', JSON.stringify(reset()) === JSON.stringify(init), '二次重置结果不同');

  const tickAfterReset = tick(resetState, now + 100, fixedRandom);
  check('重置后节拍推进为空操作（无残留计时/粒子）', tickAfterReset === resetState,
    '重置后 tick 仍推进了状态');
}

// ---------------------------------------------------------------------------
scenario('场景六：完整燃烧周期（燃尽统一收尾，节拍不再推进）');
{
  let s = initialState();
  s = add(s, OLIB, 5);
  s = setGrind(s, 100);
  s = createIncense(s);
  s = placeIncenseOnCenser(s);
  s = ignite(s);

  let now = 2_000_000;
  const fixedRandom = () => 0.5;
  for (let i = 0; i < BURN_DURATION_TICKS; i++) {
    now += 100;
    s = tick(s, now, fixedRandom);
  }
  eq('燃尽时计时达到上限', s.burntime, BURN_DURATION_TICKS);
  eq('燃尽后退出燃烧态', s.isBurning, false);
  eq('燃尽后烟雾粒子清空', s.smokeParticles.length, 0);

  const after = tick(s, now + 100, fixedRandom);
  check('燃尽后节拍推进为空操作', after === s, '燃尽后 tick 仍推进了状态');
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(56)}`);
if (failures === 0) {
  console.log(`全部通过：${checks} 项检查，0 项不一致。`);
} else {
  console.error(`发现不一致：${checks} 项检查中 ${failures} 项失败（当前场景：${currentScenario}）。`);
  process.exit(1);
}
