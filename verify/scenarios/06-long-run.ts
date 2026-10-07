/**
 * 场景 6：连续推进大量时刻，累计统计不得因浮点累积或状态残留而漂移。
 * - 20000 tick 连续推进，统计量全部为整数计数；
 * - 周期点上快照与直接求值逐位一致（无状态残留）；
 * - 整段统计 === 各子段统计之和（计数可结合，无隐藏浮点）；
 * - 同区间重复统计结果完全相同；
 * - 推进过程中每 tick 完成度与可见性保持一致。
 */

import { Simulation } from '../../src/sim/engine';
import { defaultSystem } from '../../src/sim/fixtures/defaultSystem';
import { CheckContext } from '../harness';
import { digest } from '../snapshotUtil';

const TOTAL_TICKS = 20000;

export function longRunScenario(ctx: CheckContext): void {
  const sim = new Simulation(defaultSystem);
  const cursor = sim.createCursor(0, 1);

  // 周期点快照：游标推进结果 vs 引擎直接求值
  for (let tick = 0; tick <= TOTAL_TICKS; tick += 1) {
    const snap = cursor.snapshot();
    if (tick % 1000 === 0) {
      ctx.ok(
        digest(snap) === digest(sim.snapshot(tick)),
        `tick=${tick}：游标连续推进后的快照与直接求值不一致（状态残留）`,
      );
    }
    if (tick % 24 === 0) {
      // 观测站自转整周期点：本地恒星时应精确回到 0（纯整数倍运算，无漂移）
      ctx.ok(
        snap.lstDeg === 0,
        `tick=${tick}：整自转周期后恒星时应精确为 0，实际=${snap.lstDeg}`,
      );
    }
    const completion = cursor.completion();
    ctx.ok(
      completion.visibleCount === snap.visibleCount,
      `tick=${tick}：推进中完成度与快照可见数不一致`,
    );
    cursor.advance();
  }

  // 整段统计 === 子段统计之和
  const whole = sim.accumulate(0, TOTAL_TICKS);
  const partA = sim.accumulate(0, TOTAL_TICKS / 2);
  const partB = sim.accumulate(TOTAL_TICKS / 2, TOTAL_TICKS);
  for (const id of sim.bodyIds) {
    ctx.ok(
      whole.visibleTickCounts[id]
        === partA.visibleTickCounts[id] + partB.visibleTickCounts[id],
      `星体 ${id}：整段计数(${whole.visibleTickCounts[id]})≠子段之和(${partA.visibleTickCounts[id]}+${partB.visibleTickCounts[id]})`,
    );
  }
  ctx.ok(
    whole.totalVisibleInstances
      === partA.totalVisibleInstances + partB.totalVisibleInstances,
    '整段可见实例总数 ≠ 子段之和',
  );
  ctx.ok(
    whole.steps === partA.steps + partB.steps,
    '整段步数 ≠ 子段步数之和',
  );

  // 重复统计完全一致
  const again = sim.accumulate(0, TOTAL_TICKS);
  ctx.ok(
    JSON.stringify(whole) === JSON.stringify(again),
    '同区间重复统计结果不一致',
  );

  // 推进 20000 tick 后再统计，结果不得受游标历史影响
  const afterWalk = cursor.stats(0, TOTAL_TICKS);
  ctx.ok(
    JSON.stringify(afterWalk) === JSON.stringify(whole),
    '游标推进 20000 tick 后的区间统计与直接统计不一致（状态残留漂移）',
  );
}
