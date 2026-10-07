import { angularSeparationDeg, distance } from './math';
import type {
  BodyEphemeris,
  BodyState,
  OcclusionVerdict,
  ObserverViewpoint,
  RingType
} from './types';

const RING_LABEL: Record<RingType, string> = {
  ecliptic: '黄道',
  equator: '赤道',
  galactic: '银道'
};

export function ringLabel(ring: RingType): string {
  return RING_LABEL[ring];
}

export interface OcclusionResult {
  verdicts: OcclusionVerdict[];
  /** bodyId -> 直接遮挡它的最近遮挡者 */
  occludedBy: Map<number, number>;
  depthById: Map<number, number>;
}

/**
 * 纯函数：依据观测者视角判定遮挡关系。
 *
 * 判定规则：
 * 1. 只比较同一环带上的两个星体；
 * 2. 环上角距 < 阈值时进入遮挡判定（角距相等或超过阈值则两星各自可见）；
 * 3. 不用"后画的覆盖先画的"这类顺序规则，而是比较观测者到两星的
 *    空间距离（视深），距离小者遮挡距离大者；
 * 4. 每条结论附角距、阈值与双方视深作为依据。
 */
export function computeOcclusions(
  ephemerides: BodyEphemeris[],
  observer: ObserverViewpoint,
  thresholdDeg: number
): OcclusionResult {
  const verdicts: OcclusionVerdict[] = [];
  const occludedBy = new Map<number, number>();
  const depthById = new Map<number, number>();

  const groups = new Map<RingType, BodyEphemeris[]>();
  for (const eph of ephemerides) {
    const list = groups.get(eph.ring);
    if (list) {
      list.push(eph);
    } else {
      groups.set(eph.ring, [eph]);
    }
  }

  for (const [ring, list] of groups) {
    for (const eph of list) {
      depthById.set(eph.bodyId, distance(observer.position, eph.position));
    }
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const sep = angularSeparationDeg(a.angleDeg, b.angleDeg);
        if (sep >= thresholdDeg) {
          continue;
        }
        const depthA = depthById.get(a.bodyId)!;
        const depthB = depthById.get(b.bodyId)!;
        if (depthA === depthB) {
          continue;
        }
        const nearer = depthA < depthB ? a : b;
        const farther = nearer === a ? b : a;
        const nearerDepth = Math.min(depthA, depthB);
        const fartherDepth = Math.max(depthA, depthB);
        const current = occludedBy.get(farther.bodyId);
        if (current === undefined || nearerDepth < (depthById.get(current) ?? Infinity)) {
          occludedBy.set(farther.bodyId, nearer.bodyId);
        }
        verdicts.push({
          ring,
          occluderId: nearer.bodyId,
          occludedId: farther.bodyId,
          angularSeparationDeg: sep,
          thresholdDeg,
          occluderDepth: nearerDepth,
          occludedDepth: fartherDepth,
          rationale:
            `星体 #${nearer.bodyId} 与星体 #${farther.bodyId} 在${RING_LABEL[ring]}环上` +
            `角距 ${sep.toFixed(3)}°（阈值 ${thresholdDeg}°）；` +
            `观测者视角下 #${nearer.bodyId} 视深 ${nearerDepth.toFixed(3)}，` +
            `#${farther.bodyId} 视深 ${fartherDepth.toFixed(3)}，` +
            `视深更小者在前，故 #${nearer.bodyId} 遮挡 #${farther.bodyId}。`
        });
      }
    }
  }

  verdicts.sort((x, y) => {
    if (x.ring !== y.ring) {
      return x.ring < y.ring ? -1 : 1;
    }
    return x.occludedId - y.occludedId;
  });
  return { verdicts, occludedBy, depthById };
}

/** 由星历 + 遮挡结果组装带可见性的完整星体状态，按 bodyId 排序保证确定性。 */
export function assembleBodyStates(
  ephemerides: BodyEphemeris[],
  result: OcclusionResult
): BodyState[] {
  const states: BodyState[] = ephemerides.map((eph) => {
    const blocker = result.occludedBy.get(eph.bodyId) ?? null;
    return {
      ...eph,
      depth: result.depthById.get(eph.bodyId)!,
      visible: blocker === null,
      occludedBy: blocker
    };
  });
  states.sort((a, b) => a.bodyId - b.bodyId);
  return states;
}
