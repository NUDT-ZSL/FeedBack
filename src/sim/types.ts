/**
 * 浑天仪推演核心 —— 纯计算层类型定义。
 * 本目录（src/sim）不依赖 DOM / three.js / 网络，可在 Node 中离线运行。
 */

/** 三维向量（赤道坐标系，单位任意，约定与观测站同尺度） */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 轨道型星体：以开普勒椭圆绕中心运行的行星 */
export interface OrbitalBodyConfig {
  kind: 'orbital';
  id: string;
  name: string;
  /** 物理半径（与坐标同单位），用于角径与遮挡计算 */
  physicalRadius: number;
  /** 轨道半长轴 */
  semiMajorAxis: number;
  /** 偏心率 [0,1) */
  eccentricity: number;
  /** 轨道倾角（度） */
  inclinationDeg: number;
  /** 升交点经度（度） */
  ascendingNodeDeg: number;
  /** 近地点幅角（度） */
  argOfPeriapsisDeg: number;
  /** 历元平近点角（度，tick=epochTick 时） */
  meanAnomalyAtEpochDeg: number;
  /** 平均运动（度 / tick） */
  meanMotionDegPerTick: number;
  /** 历元 tick */
  epochTick: number;
}

/** 固定型星体：以恒定周日运动绕天轴运行的恒星 */
export interface FixedBodyConfig {
  kind: 'fixed';
  id: string;
  name: string;
  physicalRadius: number;
  /** 历元赤经（度，tick=epochTick 时） */
  raAtEpochDeg: number;
  /** 赤纬（度） */
  decDeg: number;
  /** 周日运动（度 / tick），恒星通常为 0（由观测站自转带动） */
  raDriftDegPerTick: number;
  epochTick: number;
  /** 距观测站距离（与坐标同单位） */
  distance: number;
}

export type BodyConfig = OrbitalBodyConfig | FixedBodyConfig;

/** 观测站（本地固定输入，不依赖外部服务） */
export interface ObserverConfig {
  /** 地理纬度（度，北纬为正） */
  latitudeDeg: number;
  /** tick=epochTick 时的本地恒星时（度） */
  lstAtEpochDeg: number;
  /** 恒星时推进速率（度 / tick） */
  lstRateDegPerTick: number;
  epochTick: number;
}

export interface SimulationConfig {
  observer: ObserverConfig;
  bodies: BodyConfig[];
}

/** 单个星体在某一 tick 的可见性判定结果 */
export interface BodyVisibility {
  bodyId: string;
  /** 高度角（度），< 0 表示在地平线下 */
  altitudeDeg: number;
  azimuthDeg: number;
  /** 视半径（度） */
  angularRadiusDeg: number;
  /** 是否在地平线之上（含贴地平线的临界情形，由 VISIBILITY_POLICY 统一裁决） */
  aboveHorizon: boolean;
  /** 遮挡它的更近星体 id；无遮挡为 null */
  occultedBy: string | null;
  /** 是否与遮挡体处于临界相切（角距恰等于角半径之和） */
  tangent: boolean;
  /** 综合可见：地平线之上且未被遮挡 */
  visible: boolean;
}

/** 某一 tick 的完整推演快照（纯数据，可序列化比对） */
export interface TickSnapshot {
  tick: number;
  lstDeg: number;
  bodies: Record<string, {
    position: Vec3;
    altitudeDeg: number;
    azimuthDeg: number;
    visible: boolean;
    aboveHorizon: boolean;
    occultedBy: string | null;
    tangent: boolean;
  }>;
  /** 该 tick 可见星体数量（完成度统计的唯一输入） */
  visibleCount: number;
}
