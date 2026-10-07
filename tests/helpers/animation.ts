import { vi } from 'vitest';
import { Loom } from '../../src/Loom';
import { ScrollViewer } from '../../src/ScrollViewer';

export const SHUTTLE_DURATION_MS = 1750;
export const SCROLL_ANIMATION_MS = 8750;
export const FABRIC_COMPLETE_DELAY_MS = 500;
export const AUTO_ROLLBACK_DELAY_MS = 15000;
export const FRAME_DT = 1 / 60;

export function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
}

/** 完成一次完整投梭：从 fireShuttle 到纬线落定 */
export function finishShuttle(loom: Loom): void {
  advance(SHUTTLE_DURATION_MS + 1);
  loom.update(FRAME_DT);
}

/** 完成卷轴展开/回卷动画 */
export function finishScrollAnimation(scroll: ScrollViewer): void {
  advance(SCROLL_ANIMATION_MS + 1);
  scroll.update(FRAME_DT);
}

/** 连续投梭直到织物完成，返回实际完成的投梭次数 */
export function weaveToCompletion(loom: Loom): number {
  let shuttles = 0;
  while (loom.state.fabricLength < loom.state.targetLength) {
    if (!loom.fireShuttle()) break;
    finishShuttle(loom);
    shuttles += 1;
  }
  advance(FABRIC_COMPLETE_DELAY_MS + 1);
  loom.update(FRAME_DT);
  return shuttles;
}
