// 本地构造样例数据的工具：全部确定性、无网络、无外部服务。
import type {
  CompanionParams,
  PositionPoint,
  Segment,
  SegmentationParams,
} from '../../src/trajectory/index.ts';

/** 统一基准点（北京城区附近，仅作本地样例坐标） */
export const ORIGIN = { lng: 116.397, lat: 39.908 };

/** 统一基准时刻 */
export const T0 = 1_700_000_000_000;

/** 默认分段参数：50m 停留半径 / 5 分钟最短停留 / 15m 抖动带 */
export const SEG: SegmentationParams = {
  stayRadiusMeters: 50,
  minStayDurationMs: 300_000,
  jitterRadiusMeters: 15,
};

/** 默认同行参数：100m 空间阈值 / 重叠不设下限 / 2 分钟间隔合并 */
export const COMP: CompanionParams = {
  maxDistanceMeters: 100,
  minOverlapMs: 0,
  gapToleranceMs: 120_000,
};

export function mkPoint(
  id: string,
  targetId: string,
  timestamp: number,
  lng: number | null,
  lat: number | null,
): PositionPoint {
  return { id, targetId, timestamp, lng, lat };
}

/** 将米级偏移换算为经纬度（局部平面近似，仅用于构造样例） */
export function offsetMeters(
  lng: number,
  lat: number,
  dxMeters: number,
  dyMeters: number,
): { lng: number; lat: number } {
  const dLat = dyMeters / 111_320;
  const dLng = dxMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lng: lng + dLng, lat: lat + dLat };
}

/**
 * 构造一次停留：count 个点、间隔 stepMs，围绕 center 做确定性的
 * ±maxOffsetM 米小偏移（默认在抖动带内，不产生 jitter 告警）。
 */
export function mkStay(
  targetId: string,
  prefix: string,
  startTs: number,
  count: number,
  stepMs: number,
  center: { lng: number; lat: number },
  maxOffsetMeters = 5,
): PositionPoint[] {
  const points: PositionPoint[] = [];
  for (let i = 0; i < count; i++) {
    const dx = ((i % 3) - 1) * maxOffsetMeters;
    const dy = (((i * 2) % 3) - 1) * maxOffsetMeters;
    const c = offsetMeters(center.lng, center.lat, dx, dy);
    points.push(mkPoint(`${prefix}${i}`, targetId, startTs + i * stepMs, c.lng, c.lat));
  }
  return points;
}

/** 构造一段移动：按给定米级偏移序列逐点推进 */
export function mkPath(
  targetId: string,
  prefix: string,
  startTs: number,
  stepMs: number,
  offsets: Array<{ dx: number; dy: number }>,
  origin: { lng: number; lat: number } = ORIGIN,
): PositionPoint[] {
  return offsets.map((o, i) => {
    const c = offsetMeters(origin.lng, origin.lat, o.dx, o.dy);
    return mkPoint(`${prefix}${i}`, targetId, startTs + i * stepMs, c.lng, c.lat);
  });
}

/** 直接构造一个停留段（用于同行判定的精确区间样例） */
export function mkStaySeg(
  targetId: string,
  startMs: number,
  endMs: number,
  lng: number,
  lat: number,
): Segment {
  return {
    id: `seg:${targetId}:stay:${startMs}:${endMs}`,
    targetId,
    kind: 'stay',
    startMs,
    endMs,
    pointIds: [],
    anchor: { lng, lat },
  };
}

/** 确定性伪随机数（mulberry32），属性化测试用固定种子保证可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
