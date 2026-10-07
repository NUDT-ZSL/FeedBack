import type { Vec3 } from "./vec3.js";

/**
 * 星体轨道参数（本地固定星历，不依赖任何外部星历服务）。
 * 位置由椭圆参数方程给出，t 为推演秒数：
 *   真近点角 ν = phase0 + meanMotion * t
 *   距离     r = a(1-e^2)/(1+e·cosν)
 */
export interface BodySpec {
  readonly id: string;
  readonly name: string;
  /** 半长轴（浑天仪单位） */
  readonly semiMajorAxis: number;
  /** 偏心率，0 <= e < 1 */
  readonly eccentricity: number;
  /** 轨道倾角（弧度，相对水平面） */
  readonly inclination: number;
  /** 升交点黄经（弧度） */
  readonly longitudeOfAscendingNode: number;
  /** 平均角速度（弧度/秒） */
  readonly meanMotion: number;
  /** t=0 时的真近点角（弧度） */
  readonly phase0: number;
  /** 星体视觉半径（浑天仪单位），用于互相遮挡判定 */
  readonly radius: number;
}

export type VisibilityStatus = "visible" | "below-horizon" | "occluded";

export interface BodyState {
  readonly id: string;
  readonly name: string;
  /** 相对于观测者（浑天仪中心）的三维位置 */
  readonly position: Vec3;
  /** 与观测者的距离 */
  readonly distance: number;
  /** 高度角：位置向量的 y 分量，y<0 表示落在地平线以下 */
  readonly altitude: number;
  /** 角半径 asin(radius/distance)（弧度） */
  readonly angularRadius: number;
  readonly status: VisibilityStatus;
  /** 当 status === "occluded" 时，记录遮挡者 id（取最近的一个） */
  readonly occludedBy: string | null;
}

export interface MomentSnapshot {
  /** 推演时刻（秒） */
  readonly time: number;
  readonly bodies: readonly BodyState[];
  /** 该时刻可见星体数量 */
  readonly visibleCount: number;
  /** 该时刻完成度：可见星体数 / 星体总数，取值 [0,1] */
  readonly completion: number;
}

/** 单星体在整段推演中的整数计数（任何比率均在读取时由整数换算） */
export interface BodyCounters {
  readonly id: string;
  /** 参与统计的时刻总数 */
  moments: number;
  visibleMoments: number;
  belowHorizonMoments: number;
  occludedMoments: number;
}

export interface RunStats {
  readonly momentCount: number;
  readonly bodyCount: number;
  /** 所有 (时刻, 星体) 中处于可见的次数 */
  readonly totalVisible: number;
  /** 所有 (时刻, 星体) 中处于不可见的次数 */
  readonly totalInvisible: number;
  /** 全程完成度 = totalVisible / (momentCount * bodyCount) */
  readonly overallCompletion: number;
  readonly perBody: readonly BodyCounters[];
}

export interface RunResult {
  readonly snapshots: readonly MomentSnapshot[];
  readonly stats: RunStats;
}
