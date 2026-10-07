import {
  CompletionAccumulator,
  DeductionEngine,
  SAMPLE_BODIES,
} from "../../src/core/index.js";
import { checkStatsInvariants, snapshotDiff } from "../assert.js";
import type { Scenario } from "../types.js";

const STEP_SECONDS = 0.05;
const STEP_COUNT = 200_000;

/**
 * 场景四：连续推进 20 万个时刻，
 * 累计统计不得因浮点累积或状态残留而漂移。
 */
export const longRunStability: Scenario = {
  name: "long-run-stability",
  description: "连续推进大量时刻，累计统计无浮点累积漂移与状态残留",
  run() {
    const times: number[] = [];
    for (let i = 0; i < STEP_COUNT; i++) {
      times.push(i * STEP_SECONDS);
    }

    const engine = new DeductionEngine(SAMPLE_BODIES);
    const { snapshots, stats } = engine.run(times);

    const failures: string[] = [];

    // 1) 独立重算：全新累计器顺序消费同一批快照，整数计数必须完全一致。
    const recompute = new CompletionAccumulator(
      SAMPLE_BODIES.map((b) => b.id),
    );
    for (const snapshot of snapshots) {
      recompute.record(snapshot);
    }
    const recomputedStats = recompute.stats();
    if (JSON.stringify(stats) !== JSON.stringify(recomputedStats)) {
      failures.push(
        `长时推进后累计统计与独立重算不一致: ` +
          `totalVisible ${stats.totalVisible} vs ${recomputedStats.totalVisible}, ` +
          `overallCompletion ${stats.overallCompletion} vs ${recomputedStats.overallCompletion}`,
      );
    }

    // 2) 统计不变量：计数闭合、完成度由整数换算且落在 [0,1]。
    checkStatsInvariants(snapshots, stats, failures);

    // 3) 状态残留检查：经历 20 万步的引擎与全新引擎，
    //    在首、中、末时刻的快照必须逐位一致。
    const fresh = new DeductionEngine(SAMPLE_BODIES);
    for (const t of [times[0], times[Math.floor(STEP_COUNT / 2)], times[STEP_COUNT - 1]]) {
      failures.push(
        ...snapshotDiff(
          fresh.snapshotAt(t),
          engine.snapshotAt(t),
          `长时推进后 t=${t}`,
        ),
      );
    }

    return {
      name: this.name,
      failures,
      summary: `${STEP_COUNT} 个时刻连续推进（步长 ${STEP_SECONDS}s），统计整数计数复核 + 状态残留抽查`,
    };
  },
};
