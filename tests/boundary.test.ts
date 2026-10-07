// 边界输入健壮性验证: 目标长度上下限、非法数值、时间步长、NaN/负长度防护。
import { test, assert, assertEqual, assertFinite, assertNotThrows } from './harness.mjs';
import { clock } from './env/clock.mjs';
import { Loom } from '../src/Loom.ts';
import { ScrollViewer, ScrollState } from '../src/ScrollViewer.ts';

const SHUTTLE_ANIMATION_MS = 2000;

function shuttleOnce(loom: Loom): void {
  loom.fireShuttle();
  clock.advance(SHUTTLE_ANIMATION_MS);
  loom.update(0.016);
}

test('边界: 目标长度取上下限及越界值时按 10-50 钳制', () => {
  clock.reset();
  const loom = new Loom();
  loom.setTargetLength(10);
  assertEqual(loom.state.targetLength, 10, '下限 10 应原样生效');
  loom.setTargetLength(50);
  assertEqual(loom.state.targetLength, 50, '上限 50 应原样生效');
  loom.setTargetLength(5);
  assertEqual(loom.state.targetLength, 10, '低于下限应钳制到 10');
  loom.setTargetLength(0);
  assertEqual(loom.state.targetLength, 10, '0 应钳制到 10');
  loom.setTargetLength(-20);
  assertEqual(loom.state.targetLength, 10, '负值应钳制到 10');
  loom.setTargetLength(100);
  assertEqual(loom.state.targetLength, 50, '高于上限应钳制到 50');
});

test('边界: 目标长度为 NaN/Infinity 时不产生非法状态且织造可完成', () => {
  clock.reset();
  const loom = new Loom();
  loom.setTargetLength(30);

  assertNotThrows(() => {
    loom.setTargetLength(NaN);
    loom.setTargetLength(Infinity);
    loom.setTargetLength(-Infinity);
  }, '非法目标长度输入不应抛异常');
  assertEqual(loom.state.targetLength, 30, '非法输入不应污染目标长度');
  assertFinite(loom.state.targetLength, '目标长度必须有限');

  let completions = 0;
  loom.onFabricComplete = () => { completions += 1; };
  for (let i = 0; i < 15; i++) shuttleOnce(loom);
  clock.advance(500);
  assertEqual(completions, 1, '目标长度未被污染时织造应正常完成');
  assertFinite(loom.state.fabricLength, '织物长度必须有限');
});

test('边界: 时间步长为零或过大时织机更新不抛异常且状态合法', () => {
  clock.reset();
  const loom = new Loom();
  loom.fireShuttle();

  assertNotThrows(() => loom.update(0), 'deltaTime 为 0 不应抛异常');
  assertNotThrows(() => loom.update(1e9), 'deltaTime 过大不应抛异常');
  assert(loom.state.isShuttling, '动画未完成前投梭状态应保持');

  clock.advance(SHUTTLE_ANIMATION_MS);
  assertNotThrows(() => loom.update(0), '动画完成帧 deltaTime 为 0 不应抛异常');
  assertFinite(loom.state.shuttlePosition, '梭子位置必须有限');
  assertFinite(loom.state.fabricLength, '织物长度必须有限');
  assert(loom.state.fabricLength >= 0, '织物长度不应为负');
});

test('边界: 时间步长为零或过大时卷轴更新不抛异常且状态合法', () => {
  clock.reset();
  const viewer = new ScrollViewer();
  viewer.createScroll({});
  viewer.unroll();

  assertNotThrows(() => {
    viewer.update(0);
    viewer.update(1e9);
  }, '展开动画中极端时间步长不应抛异常');
  assertEqual(viewer.state, ScrollState.UNROLLING, '动画未完成前状态应保持展开中');

  clock.advance(9000);
  assertNotThrows(() => viewer.update(0), '动画完成帧 deltaTime 为 0 不应抛异常');
  assertEqual(viewer.state, ScrollState.FULLY_UNROLLED, '动画完成后应为完全展开');
});

test('边界: 连续投梭全程无 NaN 或负长度等非法状态', () => {
  clock.reset();
  const loom = new Loom();
  loom.setTargetLength(10);

  for (let i = 0; i < 8; i++) {
    shuttleOnce(loom);
    assertFinite(loom.state.fabricLength, `第 ${i + 1} 次投梭后织物长度必须有限`);
    assert(loom.state.fabricLength >= 0, `第 ${i + 1} 次投梭后织物长度不应为负`);
    assertFinite(loom.state.shuttlePosition, `第 ${i + 1} 次投梭后梭子位置必须有限`);
    for (const weft of loom.state.weftThreads) {
      assertFinite(weft.yPosition, `纬线 ${weft.id} 位置必须有限`);
    }
  }
  assertEqual(loom.state.fabricLength, 10, '完成后织物长度应冻结在目标值');
  assertEqual(loom.state.weftThreads.length, 5, '完成后纬线数应冻结');
});
