/**
 * 场景 5：可见性判定与完成度统计必须相互吻合。
 * - 每个 tick：完成度星体集合 === 可见星体集合（同一判定来源）；
 * - 不可见（地平线下/被遮挡）的星体绝不出现在完成度中；
 * - completionRatio === visibleCount / totalBodies；
 * - 区间累计计数 === 逐 tick 可见性重算的计数（无统计口径分叉）。
 */

import { Simulation } from '../../src/sim/engine';
import { defaultSystem } from '../../src/sim/fixtures/defaultSystem';
import { CheckContext } from '../harness';
import { setsEqual } from '../snapshotUtil';

export function completionConsistencyScenario(ctx: CheckContext): void {
  const sim = new Simulation(defaultSystem);
  const total = defaultSystem.bodies.length;

  const manualCounts: Record<string, number> = {};
  for (const id of sim.bodyIds) manualCounts[id] = 0;

  for (let tick = 0; tick < 500; tick += 1) {
    const snap = sim.snapshot(tick);
    const completion = sim.completion(tick);

    const visibleIds = Object.entries(snap.bodies)
      .filter(([, b]) => b.visible)
      .map(([id]) => id);

    ctx.ok(
      setsEqual(visibleIds, completion.completedBodyIds),
      `tick=${tick}：完成度星体集合与可见星体集合不一致（可见=${visibleIds.sort()} 完成=${completion.completedBodyIds.sort()}）`,
    );
    ctx.ok(
      completion.visibleCount === visibleIds.length,
      `tick=${tick}：完成度计数与可见计数不一致`,
    );
    ctx.ok(
      completion.totalBodies === total,
      `tick=${tick}：星体总数应为 ${total}，实际=${completion.totalBodies}`,
    );
    ctx.approx(
      completion.completionRatio,
      visibleIds.length / total,
      0,
      `tick=${tick}：完成度比例应精确等于 可见数/总数`,
    );

    for (const [id, body] of Object.entries(snap.bodies)) {
      if (!body.visible) {
        ctx.ok(
          !completion.completedBodyIds.includes(id),
          `tick=${tick} ${id}：不可见（aboveHorizon=${body.aboveHorizon} occultedBy=${body.occultedBy}）却计入完成度`,
        );
      } else {
        manualCounts[id] += 1;
      }
    }
  }

  const stats = sim.accumulate(0, 500);
  for (const id of sim.bodyIds) {
    ctx.ok(
      stats.visibleTickCounts[id] === manualCounts[id],
      `星体 ${id}：区间累计可见次数(${stats.visibleTickCounts[id]})与逐 tick 重算(${manualCounts[id]})不一致`,
    );
  }
}
