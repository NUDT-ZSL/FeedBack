export type RingType = 'ecliptic' | 'equator' | 'galactic';

export const RING_TYPES: RingType[] = ['ecliptic', 'equator', 'galactic'];

/** 一条环带的几何配置（推演输入，渲染层只负责按同一配置摆放圆环） */
export interface RingConfig {
  type: RingType;
  /** 环半径（场景单位） */
  radius: number;
  /** 环面倾角，0-90 度，绕 X 轴 */
  inclinationDeg: number;
  /** 升交点经度，绕 Y 轴旋转，度 */
  nodeAngleDeg: number;
}

/** 星体轨道参数（推演输入） */
export interface OrbitalParams {
  bodyId: number;
  ring: RingType;
  /** t=0 时的环上角度，度 */
  baseAngleDeg: number;
  /** 角速度，度/秒，可正可负 */
  angularVelocityDegPerSec: number;
  /** 相对环半径的径向偏移 */
  radialOffset: number;
}

/** 观测者视角（推演输入） */
export interface ObserverViewpoint {
  position: [number, number, number];
}

/** 单星体星历：某一观测时刻的角度与三维位置（与观测者无关） */
export interface BodyEphemeris {
  bodyId: number;
  ring: RingType;
  /** 环上角度，归一化到 [0, 360) */
  angleDeg: number;
  position: [number, number, number];
}

/** 一条明确的遮挡结论，含判定依据 */
export interface OcclusionVerdict {
  ring: RingType;
  occluderId: number;
  occludedId: number;
  /** 两星体在环上的角距，度 */
  angularSeparationDeg: number;
  /** 判定阈值，度 */
  thresholdDeg: number;
  /** 观测者到遮挡者的距离 */
  occluderDepth: number;
  /** 观测者到被遮挡者的距离 */
  occludedDepth: number;
  /** 人类可读的判定依据 */
  rationale: string;
}

/** 单星体在某一时刻的完整推演状态 */
export interface BodyState extends BodyEphemeris {
  /** 观测者到星体的距离 */
  depth: number;
  visible: boolean;
  occludedBy: number | null;
}

/** 某一观测时刻的完整推演结果（渲染层唯一数据来源） */
export interface DeductionSnapshot {
  /** 量化后的观测时刻（秒） */
  time: number;
  bodies: BodyState[];
  occlusions: OcclusionVerdict[];
}

export interface EngineStats {
  ephemerisHits: number;
  ephemerisMisses: number;
  snapshotHits: number;
  snapshotMisses: number;
}
