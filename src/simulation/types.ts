/** 浸染参数：推演模块的唯一输入。 */
export interface DyeingParams {
  /** 染液初始浓度，归一化到 0..1 */
  dyeConcentration: number;
  /** 单次浸染时长（秒） */
  dipDurationSec: number;
  /** 浸染次数 */
  dipCount: number;
  /** 单次晾晒（氧化）时长（秒） */
  airDrySec: number;
}

/** 吸色阶段推演结果（只依赖染液浓度、浸染时长、浸染次数）。 */
export interface UptakeStageResult {
  /** 单次浸染的吸色系数 0..1 */
  dipFactor: number;
  /** 单次浸染造成的浓度衰减比例 0..1 */
  decayPerDip: number;
  /** 推演结束后的剩余染液浓度 0..1 */
  finalConcentration: number;
  /** 染液消耗量（初始浓度 - 剩余浓度） */
  concentrationLoss: number;
  /** 未计入氧化耦合的布料着色深度 0..1 */
  rawColorDepth: number;
}

/** 氧化阶段推演结果（只依赖浸染次数、晾晒时长）。 */
export interface OxidationStageResult {
  /** 浸染次数 × 晾晒时长换算出的总晾晒时长（秒，已饱和钳制） */
  totalAirDrySec: number;
  /** 氧化进度 0..1 */
  oxidationProgress: number;
}

/** 对外暴露的完整推演结果，界面所有展示字段都从这里取。 */
export interface DyeingResult {
  dipCount: number;
  initialConcentration: number;
  /** 剩余染液浓度 0..1 */
  dyeConcentration: number;
  /** 染液消耗量 >= 0 */
  concentrationLoss: number;
  totalAirDrySec: number;
  /** 氧化进度 0..1 */
  oxidationProgress: number;
  /** 布料着色深度 0..1 */
  colorDepth: number;
  /** 色阶 0..9 */
  stage: number;
  /** 当前色值（HEX） */
  colorHex: string;
  /** 是否达到最深色阶 */
  isComplete: boolean;
}

/** 一次完整推演（含中间阶段缓存，用于增量重算）。 */
export interface Derivation {
  params: DyeingParams;
  uptake: UptakeStageResult;
  oxidation: OxidationStageResult;
  result: DyeingResult;
}

/** 单轮浸染记录。 */
export interface DyeRecord {
  id: string;
  round: number;
  timestamp: string;
  oxidationSeconds: number;
  colorHex: string;
}

export type DipStatus = 'applied' | 'duplicate' | 'locked';

/** 浸染操作引擎状态（界面交互状态，推演结果始终由参数派生）。 */
export interface EngineState {
  dipCount: number;
  records: DyeRecord[];
  /** 已应用的操作 ID，用于幂等去重 */
  appliedOpIds: string[];
  /** 氧化锁定截止时间（毫秒时间戳），期间拒绝新的浸染 */
  lockedUntil: number;
}
