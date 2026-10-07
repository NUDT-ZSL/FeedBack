/**
 * 完成度统计。
 *
 * 铁律：完成度只从可见性判定（BodyVisibility.visible）派生，
 * 不可见星体绝不计入；所有累计量都是整数计数，不在循环中累加浮点，
 * 因此长时间连续推进不会产生浮点漂移。
 */

import { BodyVisibility } from './types';

export interface TickCompletion {
  tick: number;
  visibleBodyIds: string[];
  completedBodyIds: string[];
  totalBodies: number;
  visibleCount: number;
  /** 完成度 = 可见星体数 / 星体总数，取值 [0,1]；浮点仅在最终一步产生 */
  completionRatio: number;
}

export function computeTickCompletion(
  tick: number,
  visibility: BodyVisibility[],
): TickCompletion {
  const visibleBodyIds: string[] = [];
  const completedBodyIds: string[] = [];

  for (const v of visibility) {
    if (!v.visible) continue;
    visibleBodyIds.push(v.bodyId);
    // 同一判定来源：可见 == 计入完成度，杜绝两套口径
    completedBodyIds.push(v.bodyId);
  }

  const totalBodies = visibility.length;
  return {
    tick,
    visibleBodyIds,
    completedBodyIds,
    totalBodies,
    visibleCount: visibleBodyIds.length,
    completionRatio: totalBodies === 0 ? 0 : visibleBodyIds.length / totalBodies,
  };
}

export interface AccumulatedStats {
  startTick: number;
  endTick: number;
  steps: number;
  /** 每颗星体被判定为可见的 tick 数（整数） */
  visibleTickCounts: Record<string, number>;
  /** 在区间内至少可见过一次的星体 id */
  everVisibleBodyIds: string[];
  /** 每个 tick 的可见星体数之和（整数，可用于与逐帧结果交叉核对） */
  totalVisibleInstances: number;
}

/**
 * 对 [startTick, endTick) 区间按固定步长做一次性累计统计。
 * bodyIds 显式传入：即使某颗星全程不可见，其计数也确定为 0，不依赖遍历顺序。
 */
export function accumulate(
  startTick: number,
  endTick: number,
  step: number,
  bodyIds: string[],
  evaluate: (tick: number) => BodyVisibility[],
): AccumulatedStats {
  if (step <= 0) throw new Error('step must be positive');
  if (endTick < startTick) throw new Error('endTick must be >= startTick');

  const visibleTickCounts: Record<string, number> = {};
  for (const id of bodyIds) visibleTickCounts[id] = 0;

  const everVisible = new Set<string>();
  let totalVisibleInstances = 0;
  let steps = 0;

  for (let tick = startTick; tick < endTick; tick += step) {
    const visibility = evaluate(tick);
    for (const v of visibility) {
      if (!v.visible) continue;
      if (visibleTickCounts[v.bodyId] === undefined) {
        visibleTickCounts[v.bodyId] = 0;
      }
      visibleTickCounts[v.bodyId] += 1;
      everVisible.add(v.bodyId);
      totalVisibleInstances += 1;
    }
    steps += 1;
  }

  return {
    startTick,
    endTick,
    steps,
    visibleTickCounts,
    everVisibleBodyIds: [...everVisible].sort(),
    totalVisibleInstances,
  };
}
