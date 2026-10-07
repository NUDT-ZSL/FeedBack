/**
 * 场景 3：地平线遮挡判定。
 * - 用可手算的固定星样例核对高度角与地平线判定；
 * - 临界时刻（h=0）只校验 |h| 与策略一致性（aboveHorizon === h >= 0）；
 * - 拱极星全程可见、永隐星全程不可见；
 * - 地平线以下的星体不得计入完成度。
 */

import { Simulation } from '../../src/sim/engine';
import {
  horizonExpectations,
  horizonSystem,
} from '../../src/sim/fixtures/horizonSystem';
import { VISIBILITY_POLICY } from '../../src/sim/visibility';
import { CheckContext } from '../harness';

export function horizonScenario(ctx: CheckContext): void {
  const sim = new Simulation(horizonSystem);

  for (const exp of horizonExpectations) {
    const snap = sim.snapshot(exp.tick);
    const body = snap.bodies[exp.bodyId];
    if (!body) {
      ctx.ok(false, `tick=${exp.tick}：快照中缺少星体 ${exp.bodyId}`);
      continue;
    }
    if (exp.boundary) {
      ctx.approx(
        body.altitudeDeg,
        exp.altitudeDeg,
        1e-9,
        `tick=${exp.tick} ${exp.bodyId}：临界高度角应≈0`,
      );
      ctx.ok(
        body.aboveHorizon === (body.altitudeDeg >= VISIBILITY_POLICY.horizonMinAltitudeDeg),
        `tick=${exp.tick} ${exp.bodyId}：临界判定与策略不一致（h=${body.altitudeDeg}）`,
      );
    } else {
      ctx.approx(
        body.altitudeDeg,
        exp.altitudeDeg,
        1e-9,
        `tick=${exp.tick} ${exp.bodyId}：高度角`,
      );
      ctx.ok(
        body.aboveHorizon === exp.aboveHorizon,
        `tick=${exp.tick} ${exp.bodyId}：地平线判定应为 aboveHorizon=${exp.aboveHorizon}，实际=${body.aboveHorizon}（h=${body.altitudeDeg}）`,
      );
    }
  }

  // 全周期不变量
  for (let tick = 0; tick < 24; tick += 1) {
    const snap = sim.snapshot(tick);
    const completion = sim.completion(tick);

    ctx.ok(
      snap.bodies['circumpolar'].visible,
      `tick=${tick}：拱极星应全程可见`,
    );
    ctx.ok(
      !snap.bodies['never_rise'].visible,
      `tick=${tick}：永隐星应全程不可见`,
    );
    ctx.ok(
      !completion.completedBodyIds.includes('never_rise'),
      `tick=${tick}：永隐星不可见却计入完成度`,
    );
    ctx.ok(
      completion.completedBodyIds.includes('circumpolar'),
      `tick=${tick}：拱极星可见却未计入完成度`,
    );
  }
}
