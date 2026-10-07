import type { MomentSnapshot, RunStats } from "../src/core/types.js";

/** 逐字段精确比较两个快照（浮点必须逐位相等，不使用容差）。 */
export function snapshotDiff(
  expected: MomentSnapshot,
  actual: MomentSnapshot,
  label: string,
): string[] {
  const failures: string[] = [];
  if (Object.is(expected.time, actual.time) === false) {
    failures.push(`${label}: 时刻不一致 ${expected.time} !== ${actual.time}`);
  }
  if (expected.visibleCount !== actual.visibleCount) {
    failures.push(
      `${label}: 可见数量不一致 ${expected.visibleCount} !== ${actual.visibleCount}`,
    );
  }
  if (Object.is(expected.completion, actual.completion) === false) {
    failures.push(
      `${label}: 完成度不一致 ${expected.completion} !== ${actual.completion}`,
    );
  }
  for (const a of expected.bodies) {
    const b = actual.bodies.find((x) => x.id === a.id);
    if (!b) {
      failures.push(`${label}: 星体 ${a.id} 在另一次推演中缺失`);
      continue;
    }
    const fields: [keyof typeof a, string][] = [
      ["distance", "距离"],
      ["altitude", "高度角"],
      ["angularRadius", "角半径"],
    ];
    for (const [field, cn] of fields) {
      if (Object.is(a[field], b[field]) === false) {
        failures.push(
          `${label} 星体 ${a.id}(${a.name}) ${cn}不一致: ${a[field]} !== ${b[field]}`,
        );
      }
    }
    for (const axis of ["x", "y", "z"] as const) {
      if (Object.is(a.position[axis], b.position[axis]) === false) {
        failures.push(
          `${label} 星体 ${a.id}(${a.name}) 位置.${axis} 不一致: ` +
            `${a.position[axis]} !== ${b.position[axis]}`,
        );
      }
    }
    if (a.status !== b.status) {
      failures.push(
        `${label} 星体 ${a.id}(${a.name}) 可见性不一致: ${a.status} !== ${b.status}`,
      );
    }
    if (a.occludedBy !== b.occludedBy) {
      failures.push(
        `${label} 星体 ${a.id}(${a.name}) 遮挡者不一致: ` +
          `${a.occludedBy ?? "无"} !== ${b.occludedBy ?? "无"}`,
      );
    }
  }
  return failures;
}

/**
 * 可见性与完成度统计一致性不变量（在任意时刻、任意夹具上都必须成立）：
 * 1. visibleCount 恰为 status === "visible" 的星体数；
 * 2. completion === visibleCount / 星体总数；
 * 3. occluded 必须给出遮挡者 id，below-horizon 不得给遮挡者；
 * 4. 累计统计中每颗星的三类计数之和等于参与时刻数，
 *    且所有计数加总恰好等于 (时刻数 × 星体数)。
 */
export function checkMomentInvariants(
  snapshot: MomentSnapshot,
  failures: string[],
): void {
  const t = snapshot.time;
  let manuallyVisible = 0;
  for (const body of snapshot.bodies) {
    if (body.status === "visible") {
      manuallyVisible += 1;
    }
    if (body.status === "occluded" && body.occludedBy === null) {
      failures.push(
        `t=${t} 星体 ${body.id}(${body.name}) 判定为被遮挡但缺少遮挡者`,
      );
    }
    if (body.status === "below-horizon" && body.occludedBy !== null) {
      failures.push(
        `t=${t} 星体 ${body.id}(${body.name}) 已被地平线遮挡却记录了星体遮挡者 ${body.occludedBy}`,
      );
    }
  }
  if (manuallyVisible !== snapshot.visibleCount) {
    failures.push(
      `t=${t}: 可见数量与可见性判定矛盾，计数=${snapshot.visibleCount}，逐星判定=${manuallyVisible}`,
    );
  }
  const expectedCompletion =
    snapshot.bodies.length === 0 ? 0 : manuallyVisible / snapshot.bodies.length;
  if (Object.is(snapshot.completion, expectedCompletion) === false) {
    failures.push(
      `t=${t}: 完成度 ${snapshot.completion} 与可见性判定不符，应为 ${expectedCompletion}`,
    );
  }
}

export function checkStatsInvariants(
  snapshots: readonly MomentSnapshot[],
  stats: RunStats,
  failures: string[],
): void {
  if (stats.momentCount !== snapshots.length) {
    failures.push(
      `统计时刻数 ${stats.momentCount} 与快照数 ${snapshots.length} 不符`,
    );
  }
  let recomputedVisible = 0;
  for (const snapshot of snapshots) {
    for (const body of snapshot.bodies) {
      if (body.status === "visible") recomputedVisible += 1;
    }
  }
  if (recomputedVisible !== stats.totalVisible) {
    failures.push(
      `总可见次数 ${stats.totalVisible} 与逐快照复核 ${recomputedVisible} 不符（不可见星体被计入完成度或反之）`,
    );
  }
  const denominator = stats.momentCount * stats.bodyCount;
  if (stats.totalVisible + stats.totalInvisible !== denominator) {
    failures.push(
      `可见+不可见计数 ${stats.totalVisible + stats.totalInvisible} 不等于 时刻×星体=${denominator}`,
    );
  }
  const expectedOverall = denominator === 0 ? 0 : stats.totalVisible / denominator;
  if (Object.is(stats.overallCompletion, expectedOverall) === false) {
    failures.push(
      `全程完成度 ${stats.overallCompletion} 与整数计数换算 ${expectedOverall} 不符`,
    );
  }
  if (!(Number.isFinite(stats.overallCompletion) &&
        stats.overallCompletion >= 0 &&
        stats.overallCompletion <= 1)) {
    failures.push(`全程完成度 ${stats.overallCompletion} 超出 [0,1] 或非有限数`);
  }
  for (const counter of stats.perBody) {
    const classified =
      counter.visibleMoments +
      counter.belowHorizonMoments +
      counter.occludedMoments;
    if (classified !== counter.moments) {
      failures.push(
        `星体 ${counter.id} 三类计数之和 ${classified} 不等于参与时刻数 ${counter.moments}`,
      );
    }
  }
}
