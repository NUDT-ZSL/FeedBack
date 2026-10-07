// 织造推进与落纱联动链路验证。
import { test, assert, assertEqual, assertFinite, assertNotThrows } from './harness.mjs';
import { clock } from './env/clock.mjs';
import { Loom } from '../src/Loom.ts';

const SHUTTLE_ANIMATION_MS = 2000; // > 梭子动画时长 1750ms
const FABRIC_COMPLETE_DELAY_MS = 500; // Loom 完成回调的 setTimeout 延迟

function createLoom(): Loom {
  clock.reset();
  return new Loom();
}

function shuttleOnce(loom: Loom): boolean {
  const fired = loom.fireShuttle();
  clock.advance(SHUTTLE_ANIMATION_MS);
  loom.update(0.016);
  return fired;
}

test('织造推进: 连续投梭达到目标长度后完成仅触发一次', () => {
  const loom = createLoom();
  loom.setTargetLength(10); // 每次投梭 +2，5 次达到目标
  let completions = 0;
  loom.onFabricComplete = () => { completions += 1; };

  for (let i = 0; i < 4; i++) shuttleOnce(loom);
  clock.advance(FABRIC_COMPLETE_DELAY_MS);
  assertEqual(completions, 0, '未达到目标长度不应触发完成');
  assertEqual(loom.state.fabricLength, 8, '4 次投梭后织物长度应为 8');

  shuttleOnce(loom);
  clock.advance(FABRIC_COMPLETE_DELAY_MS);
  assertEqual(loom.state.fabricLength, 10, '5 次投梭后织物长度应达到目标 10');
  assertEqual(completions, 1, '完成回调应恰好触发一次');
});

test('织造推进: 完成后继续投梭不改变长度且不重复触发完成', () => {
  const loom = createLoom();
  loom.setTargetLength(10);
  let completions = 0;
  loom.onFabricComplete = () => { completions += 1; };

  for (let i = 0; i < 5; i++) shuttleOnce(loom);
  clock.advance(FABRIC_COMPLETE_DELAY_MS);
  assertEqual(completions, 1, '前置条件: 完成应已触发一次');

  for (let i = 0; i < 3; i++) shuttleOnce(loom);
  clock.advance(FABRIC_COMPLETE_DELAY_MS * 4);
  assertEqual(completions, 1, '完成后继续投梭不应重复触发完成');
  assertEqual(loom.state.fabricLength, 10, '完成后织物长度不应再变化');
  assertEqual(loom.state.weftThreads.length, 5, '完成后纬线数不应再变化');
});

test('织造推进: 织造中调高目标长度后不提前完成、到达新目标后完成', () => {
  const loom = createLoom();
  loom.setTargetLength(10);
  let completions = 0;
  loom.onFabricComplete = () => { completions += 1; };

  for (let i = 0; i < 4; i++) shuttleOnce(loom); // 长度 8
  loom.setTargetLength(14); // 中途调高目标

  shuttleOnce(loom); // 10
  shuttleOnce(loom); // 12
  clock.advance(FABRIC_COMPLETE_DELAY_MS);
  assertEqual(completions, 0, '目标调高后未达新目标不应提前完成');

  shuttleOnce(loom); // 14
  clock.advance(FABRIC_COMPLETE_DELAY_MS);
  assertEqual(loom.state.fabricLength, 14, '织物长度应达到调整后的目标 14');
  assertEqual(completions, 1, '达到调整后目标应完成且仅一次');
});

test('织造推进: 织造中调低目标长度后按新目标完成且不永不完成', () => {
  const loom = createLoom();
  loom.setTargetLength(20);
  let completions = 0;
  loom.onFabricComplete = () => { completions += 1; };

  for (let i = 0; i < 5; i++) shuttleOnce(loom); // 长度 10
  clock.advance(FABRIC_COMPLETE_DELAY_MS);
  assertEqual(completions, 0, '未达到原目标 20 不应完成');

  loom.setTargetLength(10); // 中途调低目标至当前长度
  shuttleOnce(loom); // 12 >= 10
  clock.advance(FABRIC_COMPLETE_DELAY_MS);
  assertEqual(completions, 1, '调低目标后下一次投梭应按新目标完成');
  assertEqual(loom.state.fabricLength, 12, '完成时长度为调低目标后的首次投梭结果');
});

test('落纱联动: 同槽位连续落纱不同颜色后经线/当前色/织入纬线一致', () => {
  const loom = createLoom();
  const slot = 7;

  // 模拟 main.ts handleSilkDrop 的联动: 先落真红，再落鹅黄
  loom.setWarpColor(slot, '#cc2936');
  loom.setCurrentWeftColor('#cc2936');
  loom.setWarpColor(slot, '#ffe066');
  loom.setCurrentWeftColor('#ffe066');

  assertEqual(loom.state.warpThreads[slot].color, '#ffe066', '槽位经线颜色应为最新落纱颜色');
  assertEqual(loom.getCurrentWeftColor(), '#ffe066', '梭子当前颜色应为最新落纱颜色');

  shuttleOnce(loom);
  const wefts = loom.state.weftThreads;
  assertEqual(wefts.length, 1, '投梭一次应织入一根纬线');
  assertEqual(wefts[0].color, '#ffe066', '织入纬线应使用最新颜色，不应残留旧颜色');
  assertEqual(loom.state.warpThreads[slot + 1].color, '#d6ecf0', '相邻槽位颜色不应被错位污染');
});

test('落纱联动: 越界槽位落纱被拒绝且不改变状态、不抛异常', () => {
  const loom = createLoom();
  const beforeColors = loom.state.warpThreads.map((t) => t.color);

  assertNotThrows(() => {
    loom.setWarpColor(-1, '#000000');
    loom.setWarpColor(108, '#000000');
    loom.setWarpColor(9999, '#000000');
  }, '越界槽位落纱不应抛异常');

  loom.state.warpThreads.forEach((thread, i) => {
    assertEqual(thread.color, beforeColors[i], `经线 ${i} 颜色不应被越界落纱改变`);
  });
  assertEqual(loom.getCurrentWeftColor(), '#cc2936', '当前纬线颜色不应被越界落纱改变');
});
