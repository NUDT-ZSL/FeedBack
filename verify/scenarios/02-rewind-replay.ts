/**
 * 场景 2：时间轴回退后再前进到同一时刻，星体位置与可见性应与首次到达时一致。
 * - 前进 0→400，沿途记录快照摘要；
 * - 回退 400→0，逐 tick 与首次记录比对；
 * - 再前进 0→400，再次逐 tick 比对；
 * - 回退后重新计算的区间统计必须与首次一致（不允许状态残留）。
 */

import { Simulation } from '../../src/sim/engine';
import { defaultSystem } from '../../src/sim/fixtures/defaultSystem';
import { CheckContext } from '../harness';
import { digest } from '../snapshotUtil';

export function rewindReplayScenario(ctx: CheckContext): void {
  const sim = new Simulation(defaultSystem);
  const cursor = sim.createCursor(0, 1);

  const firstPass = new Map<number, string>();
  for (let tick = 0; tick <= 400; tick += 1) {
    firstPass.set(tick, digest(cursor.snapshot()));
    if (tick < 400) cursor.advance();
  }

  for (let n = 0; n < 400; n += 1) cursor.rewind();
  ctx.ok(cursor.currentTick === 0, `回退 400 步后游标应在 tick=0，实际=${cursor.currentTick}`);

  for (let tick = 0; tick <= 400; tick += 1) {
    const snap = digest(cursor.snapshot());
    ctx.ok(
      snap === firstPass.get(tick),
      `tick=${tick}：回退后再前进的快照与首次到达不一致`,
    );
    cursor.advance();
  }

  const statsFirst = sim.accumulate(0, 400);
  const statsAfterRewind = cursor.stats(0, 400);
  ctx.ok(
    JSON.stringify(statsFirst) === JSON.stringify(statsAfterRewind),
    '回退后重算的区间统计与首次统计不一致（存在状态残留）',
  );

  // 乱序回退（前进 3 步退 2 步）也不应影响最终到达的快照
  const cursor2 = sim.createCursor(0, 1);
  while (cursor2.currentTick < 300) {
    cursor2.advance(3);
    cursor2.rewind(2);
  }
  ctx.ok(
    digest(cursor2.snapshot()) === firstPass.get(300),
    'tick=300：乱序前进/回退后到达的快照与直接到达不一致',
  );
}
