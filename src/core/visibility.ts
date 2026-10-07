import type { BodySpec, BodyState, VisibilityStatus } from "./types.js";
import { positionAt } from "./position.js";
import type { Vec3 } from "./vec3.js";
import { clamp, dot, normalize } from "./vec3.js";

/** 角半径 asin(R/d)（弧度），距离为 0 时退化为 π/2（占据整个天球方向）。 */
export function angularRadiusOf(distance: number, radius: number): number {
  if (!(distance > 0)) return Math.PI / 2;
  return Math.asin(clamp(radius / distance, 0, 1));
}

/** 两个观测方向（从浑天仪中心指向星体）之间的夹角（弧度）。 */
export function angularSeparation(a: Vec3, b: Vec3): number {
  const ua = normalize(a);
  const ub = normalize(b);
  return Math.acos(clamp(dot(ua, ub), -1, 1));
}

/** 参与遮挡判定的最小星体描述。 */
export interface OcclusionSubject {
  readonly position: Vec3;
  readonly distance: number;
  readonly altitude: number;
  readonly angularRadius: number;
}

/**
 * 判定 near 是否遮挡 far：
 * - 地平线以下的星体既不遮挡别人也不参与被遮挡判定；
 * - near 必须更靠近观测者；
 * - 两星方向夹角小于等于两者角半径之和（临界角按“被遮挡”处理）。
 */
export function occludes(near: OcclusionSubject, far: OcclusionSubject): boolean {
  if (near.altitude < 0 || far.altitude < 0) return false;
  if (!(near.distance < far.distance)) return false;
  const theta = angularSeparation(near.position, far.position);
  return theta <= near.angularRadius + far.angularRadius;
}

/**
 * 对给定时刻的全部星体位置做可见性判定（纯函数）。
 *
 * 判定优先级：地平线遮挡 > 星间遮挡。
 * 位于地平线上（altitude === 0）判定为可见；
 * 角间距恰好等于角半径之和的临界情形判定为被遮挡。
 * 可见性是位置的纯函数，完成度统计直接消费同一结果，
 * 从机制上杜绝“判定不可见却计入完成度”。
 */
export function evaluateVisibilityAt(
  bodies: readonly BodySpec[],
  t: number,
): readonly BodyState[] {
  const subjects = bodies.map((body) => {
    const position = positionAt(body, t);
    const distance = Math.sqrt(
      position.x * position.x + position.y * position.y + position.z * position.z,
    );
    return {
      body,
      position,
      distance,
      altitude: position.y,
      angularRadius: angularRadiusOf(distance, body.radius),
    };
  });

  return subjects.map((target, i): BodyState => {
    let status: VisibilityStatus = "visible";
    let occludedBy: string | null = null;

    if (target.altitude < 0) {
      status = "below-horizon";
    } else {
      let nearestOccluderDistance = Number.POSITIVE_INFINITY;
      for (let j = 0; j < subjects.length; j++) {
        if (j === i) continue;
        const candidate = subjects[j];
        if (occludes(candidate, target) &&
            candidate.distance < nearestOccluderDistance) {
          nearestOccluderDistance = candidate.distance;
          occludedBy = candidate.body.id;
        }
      }
      if (occludedBy !== null) status = "occluded";
    }

    return {
      id: target.body.id,
      name: target.body.name,
      position: target.position,
      distance: target.distance,
      altitude: target.altitude,
      angularRadius: target.angularRadius,
      status,
      occludedBy,
    };
  });
}
