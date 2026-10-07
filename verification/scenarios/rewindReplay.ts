import { DeductionEngine, SAMPLE_BODIES } from "../../src/core/index.js";
import { snapshotDiff } from "../assert.js";
import type { Scenario } from "../types.js";

const STEP_SECONDS = 0.5;
const FORWARD_STEPS = 7200;

/**
 * 场景二：时间轴回退后再前进到同一时刻，
 * 星体位置与可见性必须与首次到达时逐位一致。
 */
export const rewindReplay: Scenario = {
  name: "rewind-replay",
  description: "时间轴回退后再前进到同一时刻，位置与可见性应与首次到达一致",
  run() {
    const engine = new DeductionEngine(SAMPLE_BODIES);
    const forwardTimes: number[] = [];
    for (let i = 0; i <= FORWARD_STEPS; i++) {
      forwardTimes.push(i * STEP_SECONDS);
    }

    const firstPass = engine.run(forwardTimes);
    const firstByTime = new Map(
      firstPass.snapshots.map((s) => [s.time, s] as const),
    );

    const rewindTimes: number[] = [];
    for (let i = FORWARD_STEPS; i >= 0; i--) {
      rewindTimes.push(i * STEP_SECONDS);
    }
    const rewindPass = engine.run(rewindTimes);

    const secondPass = engine.run(forwardTimes);

    const failures: string[] = [];
    for (const snapshot of rewindPass.snapshots) {
      const first = firstByTime.get(snapshot.time);
      if (!first) continue;
      failures.push(
        ...snapshotDiff(first, snapshot, `回退经过 t=${snapshot.time}`),
      );
    }
    for (const snapshot of secondPass.snapshots) {
      const first = firstByTime.get(snapshot.time);
      if (!first) continue;
      failures.push(
        ...snapshotDiff(first, snapshot, `回退后再次前进 t=${snapshot.time}`),
      );
    }
    return {
      name: this.name,
      failures,
      summary:
        `${FORWARD_STEPS + 1} 个时刻前进 → 回退 → 再前进，三段快照逐位比对`,
    };
  },
};
