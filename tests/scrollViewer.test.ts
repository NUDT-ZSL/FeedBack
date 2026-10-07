/**
 * 卷轴状态机验证：
 * - 悬浮/展开/回卷合法迁移完整，非法迁移被拒绝且状态不变
 * - 自动回卷计时在手动回卷、隐藏、重新创建后无残留
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { ScrollViewer, ScrollState } from '../src/ScrollViewer';
import {
  advance,
  finishScrollAnimation,
  AUTO_ROLLBACK_DELAY_MS,
} from './helpers/animation';

describe('卷轴状态机', () => {
  let scroll: ScrollViewer;
  let texture: THREE.Texture;
  let unrollCount: number;
  let rollbackCount: number;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    scroll = new ScrollViewer();
    texture = new THREE.Texture();
    unrollCount = 0;
    rollbackCount = 0;
    scroll.onUnrollComplete = () => {
      unrollCount += 1;
    };
    scroll.onRollbackComplete = () => {
      rollbackCount += 1;
    };
  });

  afterEach(() => {
    scroll.dispose();
    vi.useRealTimers();
  });

  it('初始为隐藏态，创建卷轴后进入悬浮态', () => {
    expect(scroll.state).toBe(ScrollState.HIDDEN);
    scroll.createScroll(texture);
    expect(scroll.state).toBe(ScrollState.FLOATING);
  });

  it('合法迁移链：悬浮 -> 展开 -> 完全展开 -> 回卷 -> 悬浮', () => {
    scroll.createScroll(texture);

    expect(scroll.unroll()).toBe(true);
    expect(scroll.state).toBe(ScrollState.UNROLLING);

    finishScrollAnimation(scroll);
    expect(scroll.state).toBe(ScrollState.FULLY_UNROLLED);
    expect(unrollCount).toBe(1);

    expect(scroll.rollback()).toBe(true);
    expect(scroll.state).toBe(ScrollState.ROLLING_BACK);

    finishScrollAnimation(scroll);
    expect(scroll.state).toBe(ScrollState.FLOATING);
    expect(rollbackCount).toBe(1);
  });

  it('非法迁移被拒绝且状态不变', () => {
    // 隐藏态：展开/回卷均拒绝
    expect(scroll.unroll()).toBe(false);
    expect(scroll.rollback()).toBe(false);
    expect(scroll.state).toBe(ScrollState.HIDDEN);

    scroll.createScroll(texture);

    // 悬浮态：未展开就回卷被拒绝
    expect(scroll.rollback()).toBe(false);
    expect(scroll.state).toBe(ScrollState.FLOATING);

    // 展开中：重复展开与回卷均拒绝
    expect(scroll.unroll()).toBe(true);
    expect(scroll.unroll()).toBe(false);
    expect(scroll.rollback()).toBe(false);
    expect(scroll.state).toBe(ScrollState.UNROLLING);

    finishScrollAnimation(scroll);

    // 完全展开：重复展开拒绝
    expect(scroll.unroll()).toBe(false);
    expect(scroll.state).toBe(ScrollState.FULLY_UNROLLED);

    // 回卷中：再次回卷/展开均拒绝
    expect(scroll.rollback()).toBe(true);
    expect(scroll.rollback()).toBe(false);
    expect(scroll.unroll()).toBe(false);
    expect(scroll.state).toBe(ScrollState.ROLLING_BACK);

    finishScrollAnimation(scroll);

    // 已回卷（回到悬浮）再回卷被拒绝
    expect(scroll.rollback()).toBe(false);
    expect(scroll.state).toBe(ScrollState.FLOATING);
  });

  it('完全展开 15 秒后自动回卷一次', () => {
    scroll.createScroll(texture);
    scroll.unroll();
    finishScrollAnimation(scroll);
    expect(scroll.state).toBe(ScrollState.FULLY_UNROLLED);
    expect(scroll.hasPendingAutoRollback()).toBe(true);

    advance(AUTO_ROLLBACK_DELAY_MS - 1);
    scroll.update(1 / 60);
    expect(scroll.state).toBe(ScrollState.FULLY_UNROLLED);

    advance(2);
    expect(scroll.state).toBe(ScrollState.ROLLING_BACK);
    expect(scroll.hasPendingAutoRollback()).toBe(false);

    finishScrollAnimation(scroll);
    expect(scroll.state).toBe(ScrollState.FLOATING);
    expect(rollbackCount).toBe(1);

    // 自动回卷只触发一次，不残留
    advance(AUTO_ROLLBACK_DELAY_MS * 2);
    scroll.update(1 / 60);
    expect(scroll.state).toBe(ScrollState.FLOATING);
    expect(rollbackCount).toBe(1);
  });

  it('手动回卷后自动回卷计时不残留', () => {
    scroll.createScroll(texture);
    scroll.unroll();
    finishScrollAnimation(scroll);
    expect(scroll.hasPendingAutoRollback()).toBe(true);

    expect(scroll.rollback()).toBe(true);
    expect(scroll.hasPendingAutoRollback()).toBe(false);
    finishScrollAnimation(scroll);
    expect(scroll.state).toBe(ScrollState.FLOATING);

    // 超过原自动回卷时点，不应有任何额外触发
    advance(AUTO_ROLLBACK_DELAY_MS * 2);
    scroll.update(1 / 60);
    expect(scroll.state).toBe(ScrollState.FLOATING);
    expect(rollbackCount).toBe(1);
  });

  it('隐藏后自动回卷计时不残留', () => {
    scroll.createScroll(texture);
    scroll.unroll();
    finishScrollAnimation(scroll);
    expect(scroll.hasPendingAutoRollback()).toBe(true);

    scroll.hide();
    expect(scroll.state).toBe(ScrollState.HIDDEN);
    expect(scroll.hasPendingAutoRollback()).toBe(false);

    advance(AUTO_ROLLBACK_DELAY_MS * 2);
    scroll.update(1 / 60);
    expect(scroll.state).toBe(ScrollState.HIDDEN);
    expect(rollbackCount).toBe(0);
  });

  it('重新创建卷轴后旧计时不残留，展开后不会被旧计时提前回卷', () => {
    scroll.createScroll(texture);
    scroll.unroll();
    finishScrollAnimation(scroll);
    expect(scroll.state).toBe(ScrollState.FULLY_UNROLLED);

    // 织物再次完成，重新创建卷轴
    scroll.createScroll(texture);
    expect(scroll.state).toBe(ScrollState.FLOATING);
    expect(scroll.hasPendingAutoRollback()).toBe(false);

    // 立即展开
    expect(scroll.unroll()).toBe(true);
    finishScrollAnimation(scroll);
    expect(scroll.state).toBe(ScrollState.FULLY_UNROLLED);

    // 旧计时若残留，会在第一次展开的 15 秒时点触发回卷；
    // 新计时从重新展开完成起算，15 秒前状态必须保持完全展开
    advance(AUTO_ROLLBACK_DELAY_MS - 1);
    scroll.update(1 / 60);
    expect(scroll.state).toBe(ScrollState.FULLY_UNROLLED);
    expect(rollbackCount).toBe(0);

    advance(2);
    expect(scroll.state).toBe(ScrollState.ROLLING_BACK);
  });

  it('点击悬浮卷轴触发展开，点击非悬浮卷轴不触发', () => {
    scroll.createScroll(texture);
    let clicks = 0;
    scroll.onClick = () => {
      clicks += 1;
    };

    scroll.handleClick();
    expect(clicks).toBe(1);
    expect(scroll.state).toBe(ScrollState.UNROLLING);

    scroll.handleClick();
    expect(clicks).toBe(1);
  });
});
