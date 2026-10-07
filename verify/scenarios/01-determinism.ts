/**
 * 场景 1：同一时刻重复推演应得到完全一致的结果。
 * - 同一引擎实例对同一 tick 反复推演；
 * - 两个独立构造的引擎实例（模拟两次独立推演会话）；
 * - 整批结果二次复跑，摘要完全相同。
 */

import { Simulation } from '../../src/sim/engine';
import { defaultSystem } from '../../src/sim/fixtures/defaultSystem';
import { CheckContext } from '../harness';
import { digest } from '../snapshotUtil';

export function determinismScenario(ctx: CheckContext): void {
  const runOnce = () => {
    const simA = new Simulation(defaultSystem);
    const simB = new Simulation(defaultSystem);
    const digests: string[] = [];

    for (let tick = 0; tick <= 720; tick += 7) {
      const first = simA.snapshot(tick);
      const second = simA.snapshot(tick);
      const otherInstance = simB.snapshot(tick);

      ctx.ok(
        digest(first) === digest(second),
        `tick=${tick}：同一实例重复推演结果不一致`,
      );
      ctx.ok(
        digest(first) === digest(otherInstance),
        `tick=${tick}：独立实例推演结果不一致`,
      );

      const completion = simA.completion(tick);
      ctx.ok(
        completion.visibleCount === first.visibleCount,
        `tick=${tick}：完成度可见数(${completion.visibleCount})与快照可见数(${first.visibleCount})不一致`,
      );
      digests.push(digest(first));
    }
    return digests.join('|');
  };

  const pass1 = runOnce();
  const pass2 = runOnce();
  ctx.ok(pass1 === pass2, '整批评测复跑结果摘要不一致');
}
