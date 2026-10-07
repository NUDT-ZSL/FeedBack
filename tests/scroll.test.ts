// 卷轴状态机与自动回卷计时链路验证。
import { test, assert, assertEqual, assertNotThrows } from './harness.mjs';
import { clock } from './env/clock.mjs';
import { ScrollViewer, ScrollState } from '../src/ScrollViewer.ts';

const UNROLL_ANIMATION_MS = 9000; // 展开/回卷动画时长 8750ms
const AUTO_ROLLBACK_DELAY_MS = 15000;

function createViewer(): ScrollViewer {
  clock.reset();
  return new ScrollViewer();
}

function unrollFully(viewer: ScrollViewer): void {
  viewer.unroll();
  assertEqual(viewer.state, ScrollState.UNROLLING);
  clock.advance(UNROLL_ANIMATION_MS);
  viewer.update(0.016);
  assertEqual(viewer.state, ScrollState.FULLY_UNROLLED);
}

test('卷轴状态机: 合法迁移链完整可走通', () => {
  const viewer = createViewer();
  assertEqual(viewer.state, ScrollState.HIDDEN, '初始状态应为隐藏');

  viewer.createScroll({});
  assertEqual(viewer.state, ScrollState.FLOATING, '创建卷轴后应悬浮');

  unrollFully(viewer);

  viewer.rollback();
  assertEqual(viewer.state, ScrollState.ROLLING_BACK, '手动回卷应进入回卷中');
  clock.advance(UNROLL_ANIMATION_MS);
  viewer.update(0.016);
  assertEqual(viewer.state, ScrollState.FLOATING, '回卷完成后应回到悬浮');
});

test('卷轴状态机: 非法迁移被拒绝且当前状态不变', () => {
  const viewer = createViewer();

  viewer.unroll();
  assertEqual(viewer.state, ScrollState.HIDDEN, '未创建卷轴时展开应被拒绝');
  viewer.rollback();
  assertEqual(viewer.state, ScrollState.HIDDEN, '未展开就回卷应被拒绝');

  viewer.createScroll({});
  viewer.rollback();
  assertEqual(viewer.state, ScrollState.FLOATING, '悬浮态未展开就回卷应被拒绝');

  viewer.unroll();
  viewer.rollback();
  assertEqual(viewer.state, ScrollState.UNROLLING, '展开动画中回卷应被拒绝');
  clock.advance(UNROLL_ANIMATION_MS);
  viewer.update(0.016);

  viewer.rollback();
  viewer.rollback();
  assertEqual(viewer.state, ScrollState.ROLLING_BACK, '回卷中重复回卷应被拒绝');
  clock.advance(UNROLL_ANIMATION_MS);
  viewer.update(0.016);

  viewer.rollback();
  assertEqual(viewer.state, ScrollState.FLOATING, '已回卷后再回卷应被拒绝');
});

test('卷轴自动回卷: 完全展开后计时结束自动回卷', () => {
  const viewer = createViewer();
  viewer.createScroll({});
  unrollFully(viewer);

  clock.advance(AUTO_ROLLBACK_DELAY_MS - 100);
  viewer.update(0.016);
  assertEqual(viewer.state, ScrollState.FULLY_UNROLLED, '未到自动回卷时间应保持展开');

  clock.advance(200);
  assertEqual(viewer.state, ScrollState.ROLLING_BACK, '15 秒后应自动进入回卷');
  clock.advance(UNROLL_ANIMATION_MS);
  viewer.update(0.016);
  assertEqual(viewer.state, ScrollState.FLOATING, '自动回卷完成后应回到悬浮');
});

test('卷轴自动回卷: 手动回卷后旧计时不残留触发', () => {
  const viewer = createViewer();
  viewer.createScroll({});
  unrollFully(viewer);

  viewer.rollback(); // 在 15 秒自动回卷前手动回卷
  clock.advance(UNROLL_ANIMATION_MS);
  viewer.update(0.016);
  assertEqual(viewer.state, ScrollState.FLOATING);

  clock.advance(60000);
  viewer.update(0.016);
  assertEqual(viewer.state, ScrollState.FLOATING, '旧自动回卷计时不应在手动回卷后残留触发');
  assertEqual(clock.pendingTimerCount(), 0, '回卷完成后不应残留计时器');
});

test('卷轴自动回卷: 隐藏后旧计时不残留触发', () => {
  const viewer = createViewer();
  viewer.createScroll({});
  unrollFully(viewer);
  assert(clock.pendingTimerCount() > 0, '完全展开后应已启动自动回卷计时');

  viewer.hide();
  assertEqual(viewer.state, ScrollState.HIDDEN, '隐藏后状态应为隐藏');
  assertEqual(clock.pendingTimerCount(), 0, '隐藏后不应残留计时器');

  clock.advance(60000);
  viewer.update(0.016);
  assertEqual(viewer.state, ScrollState.HIDDEN, '隐藏后旧计时不应触发状态变化');
});

test('卷轴自动回卷: 重新创建卷轴清除旧计时且新计时正常', () => {
  const viewer = createViewer();
  viewer.createScroll({});
  unrollFully(viewer);
  assert(clock.pendingTimerCount() > 0, '完全展开后应已启动自动回卷计时');

  viewer.createScroll({}); // 展开期间重新创建
  assertEqual(viewer.state, ScrollState.FLOATING, '重新创建后应为新的悬浮卷轴');
  assertEqual(clock.pendingTimerCount(), 0, '重新创建应清除旧卷轴的计时');

  unrollFully(viewer);
  clock.advance(AUTO_ROLLBACK_DELAY_MS - 1000);
  viewer.update(0.016);
  assertEqual(viewer.state, ScrollState.FULLY_UNROLLED, '新卷轴不应被旧计时提前回卷');

  clock.advance(2000);
  assertEqual(viewer.state, ScrollState.ROLLING_BACK, '新卷轴的自动回卷计时应正常触发');
});
