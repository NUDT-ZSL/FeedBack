import {
  DeductionEngine,
  SAMPLE_BODIES,
  evaluateVisibilityAt,
} from "../../src/core/index.js";
import type { BodySpec, MomentSnapshot } from "../../src/core/types.js";
import { checkMomentInvariants, checkStatsInvariants } from "../assert.js";
import {
  BELOW_HORIZON_BODIES,
  HORIZON_EDGE_BODIES,
  MUTUAL_CLEAR_BODIES,
  MUTUAL_OCCULTATION_BODIES,
  makeMutualEdgeBodies,
} from "../fixtures.js";
import type { Scenario } from "../types.js";

function bodyOf(snapshot: MomentSnapshot, id: string) {
  return snapshot.bodies.find((b) => b.id === id);
}

/**
 * 场景三：地平线遮挡、星间遮挡与临界位置下，
 * 可见性判定与完成度统计必须相互吻合。
 */
export const occlusionConsistency: Scenario = {
  name: "occlusion-consistency",
  description: "遮挡（地平线/星间/临界）下可见性判定与完成度统计相互吻合",
  run() {
    const failures: string[] = [];

    // 1) 地平线遮挡：沉星不可见且不计入完成度，高星可见。
    {
      const engine = new DeductionEngine(BELOW_HORIZON_BODIES);
      const snapshot = engine.snapshotAt(0);
      const sunk = bodyOf(snapshot, "sunk");
      const high = bodyOf(snapshot, "high");
      if (sunk?.status !== "below-horizon") {
        failures.push(`t=0 沉星应被地平线遮挡，实际 status=${sunk?.status}`);
      }
      if (high?.status !== "visible") {
        failures.push(`t=0 高星应可见，实际 status=${high?.status}`);
      }
      if (snapshot.visibleCount !== 1 || snapshot.completion !== 0.5) {
        failures.push(
          `t=0 地平线遮挡下完成度应为 1/2，实际 visibleCount=${snapshot.visibleCount} completion=${snapshot.completion}`,
        );
      }
      checkMomentInvariants(snapshot, failures);
    }

    // 2) 地平线临界：altitude 恰好为 0，按规则判定为可见并计入完成度。
    {
      const engine = new DeductionEngine(HORIZON_EDGE_BODIES);
      const snapshot = engine.snapshotAt(0);
      const edge = bodyOf(snapshot, "edge");
      if (edge?.altitude !== 0) {
        failures.push(`t=0 临界星高度角应恰为 0，实际 ${edge?.altitude}`);
      }
      if (edge?.status !== "visible") {
        failures.push(`t=0 临界星（高度角=0）按规则应可见，实际 ${edge?.status}`);
      }
      if (snapshot.completion !== 1) {
        failures.push(`t=0 临界星应计入完成度，实际 completion=${snapshot.completion}`);
      }
      checkMomentInvariants(snapshot, failures);
    }

    // 3) 星间遮挡：远星被近星遮挡，不计入完成度，遮挡者记录为近星。
    {
      const engine = new DeductionEngine(MUTUAL_OCCULTATION_BODIES);
      const snapshot = engine.snapshotAt(0);
      const near = bodyOf(snapshot, "near");
      const far = bodyOf(snapshot, "far");
      if (near?.status !== "visible") {
        failures.push(`t=0 近星应可见，实际 status=${near?.status}`);
      }
      if (far?.status !== "occluded" || far.occludedBy !== "near") {
        failures.push(
          `t=0 远星应被近星遮挡，实际 status=${far?.status} occludedBy=${far?.occludedBy ?? "无"}`,
        );
      }
      if (snapshot.visibleCount !== 1 || snapshot.completion !== 0.5) {
        failures.push(
          `t=0 星间遮挡下完成度应为 1/2，实际 visibleCount=${snapshot.visibleCount} completion=${snapshot.completion}`,
        );
      }
      checkMomentInvariants(snapshot, failures);
    }

    // 4) 互掩之外：角间距明显大于角半径之和，两星均可见。
    {
      const engine = new DeductionEngine(MUTUAL_CLEAR_BODIES);
      const snapshot = engine.snapshotAt(0);
      if (snapshot.visibleCount !== 2 || snapshot.completion !== 1) {
        failures.push(
          `t=0 无遮挡情形下两星均应可见，实际 visibleCount=${snapshot.visibleCount}`,
        );
      }
      checkMomentInvariants(snapshot, failures);
    }

    // 5) 互掩临界：临界角回代构造，不断言具体朝向，
    //    只要求重复求值逐位一致、判定与统计吻合。
    {
      const edgeBodies = makeMutualEdgeBodies();
      const engine = new DeductionEngine(edgeBodies);
      const first = engine.snapshotAt(0);
      const second = engine.snapshotAt(0);
      if (JSON.stringify(first) !== JSON.stringify(second)) {
        failures.push("t=0 互掩临界位置重复求值结果不一致");
      }
      const far = bodyOf(first, "far");
      if (far?.status !== "occluded" && far?.status !== "visible") {
        failures.push(`t=0 临界远星出现非预期状态 ${far?.status}`);
      }
      checkMomentInvariants(first, failures);
    }

    // 6) 不变量巡检：默认星历 + 全部夹具在密集时刻上，
    //    逐时刻校验可见性与完成度吻合，且三类遮挡情形均被覆盖。
    {
      const bodySets: readonly (readonly BodySpec[])[] = [
        SAMPLE_BODIES,
        BELOW_HORIZON_BODIES,
        HORIZON_EDGE_BODIES,
        MUTUAL_OCCULTATION_BODIES,
        MUTUAL_CLEAR_BODIES,
        makeMutualEdgeBodies(),
      ];
      let belowHorizonSeen = 0;
      let occludedSeen = 0;
      let momentsChecked = 0;
      for (const bodies of bodySets) {
        const engine = new DeductionEngine(bodies);
        const times: number[] = [];
        for (let i = 0; i < 400; i++) times.push(i * 0.37);
        const { snapshots, stats } = engine.run(times);
        for (const snapshot of snapshots) {
          checkMomentInvariants(snapshot, failures);
          momentsChecked += 1;
          for (const body of snapshot.bodies) {
            if (body.status === "below-horizon") belowHorizonSeen += 1;
            if (body.status === "occluded") occludedSeen += 1;
          }
        }
        checkStatsInvariants(snapshots, stats, failures);
        // 独立重算可见性，验证引擎快照与核心纯函数一致。
        const independent = evaluateVisibilityAt(bodies, times[times.length - 1]);
        const fromSnapshot = snapshots[snapshots.length - 1].bodies;
        if (JSON.stringify(independent) !== JSON.stringify(fromSnapshot)) {
          failures.push(
            `t=${times[times.length - 1]} 引擎快照与独立重算的可见性不一致`,
          );
        }
      }
      if (belowHorizonSeen === 0) {
        failures.push("巡检未覆盖到任何地平线遮挡情形，样例数据不足");
      }
      if (occludedSeen === 0) {
        failures.push("巡检未覆盖到任何星间遮挡情形，样例数据不足");
      }
      if (momentsChecked === 0) {
        failures.push("巡检未检查任何时刻");
      }
    }

    return {
      name: this.name,
      failures,
      summary:
        "5 组定向夹具（地平线/临界/互掩/互掩临界/无遮挡）+ 6 组星历 × 400 时刻不变量巡检",
    };
  },
};
