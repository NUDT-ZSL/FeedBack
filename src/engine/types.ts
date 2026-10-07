// 浑天仪星盘推演核心层 —— 类型定义
// 核心层不依赖 React / three / DOM，可在 Node 中独立运行与验证。

export type RingKey = 'ecliptic' | 'equator' | 'galactic';

export const RING_KEYS: readonly RingKey[] = ['ecliptic', 'equator', 'galactic'];

/** 三条环带的颜色语义（与既有 UI 约定保持一致） */
export const RING_COLORS: Record<RingKey, string> = {
  ecliptic: '#ffd700',
  equator: '#00bfff',
  galactic: '#ff4444'
};

export const RING_LABELS: Record<RingKey, string> = {
  ecliptic: '黄道',
  equator: '赤道',
  galactic: '银道'
};

export type Vec3 = readonly [number, number, number];

/**
 * 星体轨道参数。
 * homeRing：星体所属（绕行）的环带；radius：轨道半径（浑天仪半径约 5）。
 * phase0：t0 时刻在 homeRing 平面内的初相角（度）。
 * period：绕环周期（毫秒）；inclination / azimuth：该环带平面相对默认平面的倾角与方位角（度）。
 * depthOrder：深度相同（在深度阈值以内）时的稳定决胜序，越小越靠近观测者。
 * magnitude：视星等（越小越亮），深度阈值内的平局时较亮者可见。
 * revision：参数修订号，修正轨道参数时递增，用于增量失效。
 */
export interface OrbitalBodyParams {
  id: string;
  name: string;
  homeRing: RingKey;
  radius: number;
  phase0: number;
  period: number;
  inclination: number;
  azimuth: number;
  depthOrder: number;
  magnitude: number;
  color?: string;
  revision: number;
}

/** 观测者视角：观测点位置 + 视线目标（一般为浑天仪中心） */
export interface ObserverView {
  position: Vec3;
  target: Vec3;
}

/** 推演配置（角度阈值、量化粒度等） */
export interface SimulationConfig {
  /** 环带上角度差小于该值（度）才进入遮挡候选 */
  angleThresholdDeg: number;
  /** 视线方向视位置角距小于该值（弧度）判为投影重叠 */
  angularSeparationRad: number;
  /** 深度差小于该值（世界单位）时认为深度相同，改用视星等/稳定序号决胜 */
  depthEpsilon: number;
  /** 时间轴量化粒度（毫秒），同一桶内时刻复用同一推演结果，保证拖动不漂移 */
  timeQuantumMs: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  angleThresholdDeg: 3,
  angularSeparationRad: 0.06,
  depthEpsilon: 0.05,
  timeQuantumMs: 50
};

/** 单星体单时刻的角度结果：在三条环带上的角度（度，0..360）；几何退化（轨道轴与环轴平行）时为 null */
export type RingAngles = Record<RingKey, number | null>;

/** 单星体单时刻的几何结果 */
export interface BodyPosition {
  id: string;
  /** 三条环带上的角度（度） */
  angles: RingAngles;
  /** 浑天仪中心坐标系下的三维位置 */
  position: Vec3;
  /** 视线方向视位置角距（与视线轴的夹角，弧度） */
  viewAngle: number;
  /** 沿视线的深度：到观测者平面的距离，越小越靠近观测者 */
  viewDepth: number;
  /** 视图平面坐标（单位向量基底，用于渲染标签与判定） */
  viewX: number;
  viewY: number;
  revision: number;
}

/** 单条遮挡关系的判定依据 */
export interface OcclusionEvidence {
  /** 角度差最小的环带（二者在该环带上角距最小） */
  ring: RingKey;
  /** 该环带上的角度差（度，0..180） */
  angleDiffDeg: number;
  /** 视图平面视位置角距（弧度） */
  viewSeparationRad: number;
  /** 可见者深度 */
  depthVisible: number;
  /** 被遮挡者深度 */
  depthHidden: number;
  /** 实际采用的决胜规则：depth 深度不同 / magnitude 深度相同看亮度 / order 仍相同看稳定序号 */
  tieBreak: 'depth' | 'magnitude' | 'order';
}

export type VisibilityState = 'visible' | 'occluded' | 'occluding';

export interface BodyVisibility {
  id: string;
  state: VisibilityState;
  /** 遮挡了哪些星体 */
  occludes: string[];
  /** 被哪颗星体遮挡（state === 'occluded' 时非空） */
  hiddenBy: string | null;
}

/** 一个时刻的完整推演结果（纯数据，可 JSON 序列化、可脱离渲染层验证） */
export interface SimulationFrame {
  /** 量化后的时刻（毫秒） */
  time: number;
  bodies: BodyPosition[];
  visibilities: BodyVisibility[];
  /** 所有遮挡关系（可见者 -> 被遮挡者 + 依据） */
  occlusions: OcclusionRelation[];
  /** 结果指纹：同一输入重复推演必须一致 */
  hash: string;
}

export interface OcclusionRelation {
  visibleId: string;
  hiddenId: string;
  evidence: OcclusionEvidence;
}

export interface TimeRange {
  start: number;
  end: number;
  step: number;
}

export interface BatchResult {
  frames: SimulationFrame[];
  /** 参与推演的星体 id（排序后） */
  bodyIds: string[];
  config: SimulationConfig;
}
