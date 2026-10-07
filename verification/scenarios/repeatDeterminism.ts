import { DeductionEngine, SAMPLE_BODIES } from "../../src/core/index.js";
import { snapshotDiff } from "../assert.js";
import type { Scenario } from "../types.js";

const MOMENT_COUNT = 2000;
const TIME_SPAN_SECONDS = 7200;

/** 场景一：同一时刻重复推演，两次独立运行的结果必须逐位一致。 */
export const repeatDeterminism: Scenario = {
  name: "repeat-determinism",
  description: "同一时刻重复推演应得到完全一致的结果",
  run() {
    const times: number[] = [];
    for (let i = 0; i < MOMENT_COUNT; i++) {
      times.push((i * TIME_SPAN_SECONDS) / MOMENT_COUNT);
    }
    const first = new DeductionEngine(SAMPLE_BODIES).run(times);
    const second = new DeductionEngine(SAMPLE_BODIES).run(times);

    const failures: string[] = [];
    for (let i = 0; i < times.length; i++) {
      failures.push(
        ...snapshotDiff(
          first.snapshots[i],
          second.snapshots[i],
          `t=${times[i]}`,
        ),
      );
    }
    if (JSON.stringify(first.stats) !== JSON.stringify(second.stats)) {
      failures.push("两次运行的累计统计不一致");
    }
    return {
      name: this.name,
      failures,
      summary: `${MOMENT_COUNT} 个时刻 × ${SAMPLE_BODIES.length} 颗星体，两次独立推演逐位比对`,
    };
  },
};
