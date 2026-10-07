import type { BodySpec } from "../src/core/types.js";

/**
 * 遮挡场景专用夹具（本地固定输入）。
 *
 * 所有夹具均取 meanMotion = 0，星体静止于 phase0 指定的位置，
 * 使 t = 0 时刻的遮挡关系完全可预期、可手算复核。
 */

function staticBody(
  id: string,
  name: string,
  phase0: number,
  inclinationDeg: number,
  radius: number,
  semiMajorAxis = 6,
): BodySpec {
  return {
    id,
    name,
    semiMajorAxis,
    eccentricity: 0,
    inclination: (inclinationDeg * Math.PI) / 180,
    longitudeOfAscendingNode: 0,
    meanMotion: 0,
    phase0,
    radius,
  };
}

/** 地平线以下：ν = π/2、倾角 90°，位置为 (0, -a, 0)，altitude = -6。 */
export const BELOW_HORIZON_BODIES: readonly BodySpec[] = [
  staticBody("sunk", "沉星", Math.PI / 2, 90, 0.4),
  staticBody("high", "高星", (3 * Math.PI) / 2, 90, 0.4),
];

/** 地平线临界：ν = 0，位置 (a, 0, 0)，altitude 恰好为 0，按规则判定为可见。 */
export const HORIZON_EDGE_BODIES: readonly BodySpec[] = [
  staticBody("edge", "临界星", 0, 45, 0.4),
];

/**
 * 互掩：近星位于 (0,0,5) 半径 0.5（角半径 ≈ 0.1002 rad），
 * 远星位于 (-0.8,0,7.96) 半径 0.4（角半径 ≈ 0.0500 rad），
 * 方向夹角 ≈ 0.0998 rad < 两者角半径之和 → 远星被近星遮挡。
 */
export const MUTUAL_OCCULTATION_BODIES: readonly BodySpec[] = [
  staticBody("near", "近星", Math.PI / 2, 0, 0.5, 5),
  staticBody("far", "远星", Math.PI / 2 + 0.1, 0, 0.4, 8),
];

/** 与互掩夹具同构但角间距 0.5 rad，远大于角半径之和 → 两星均可见。 */
export const MUTUAL_CLEAR_BODIES: readonly BodySpec[] = [
  staticBody("near", "近星", Math.PI / 2, 0, 0.5, 5),
  staticBody("far", "远星", Math.PI / 2 + 0.5, 0, 0.4, 8),
];

/**
 * 互掩临界：远星方向恰好取在两星角半径之和的临界角上
 * （临界角由核心公式 asin(R/d) 计算后回代构造）。
 * 浮点回代可能落在临界线任一侧，因此不断言具体判定结果，
 * 只验证：重复求值逐位一致、判定与完成度统计严格吻合。
 */
export function makeMutualEdgeBodies(): readonly BodySpec[] {
  const nearDistance = 5;
  const farDistance = 8;
  const nearRadius = 0.5;
  const farRadius = 0.4;
  const criticalAngle =
    Math.asin(nearRadius / nearDistance) + Math.asin(farRadius / farDistance);
  return [
    staticBody("near", "近星", Math.PI / 2, 0, nearRadius, nearDistance),
    staticBody("far", "远星", Math.PI / 2 + criticalAngle, 0, farRadius, farDistance),
  ];
}
