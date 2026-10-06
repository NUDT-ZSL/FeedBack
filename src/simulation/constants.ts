// 推演口径常量：所有阈值集中在此，调整阈值后重跑测试即可比对前后差异。

// 河道几何
export const RIVER_LENGTH = 80

// 水位允许范围与默认值（UI 滑条 0-10 丈，默认 5）
export const WATER_LEVEL_MIN = 0
export const WATER_LEVEL_MAX = 10
export const DEFAULT_WATER_LEVEL = 5

// 风速允许范围与默认值（旋钮 0-8 级，默认 2 级）
export const WIND_SPEED_MIN = 0
export const WIND_SPEED_MAX = 8
export const DEFAULT_WIND_SPEED = 2

// 吃水换算：有效吃水 = 基础吃水 + (基准水位 - 当前水位) * 水位吃水系数
// （从 BridgeScene/ShipManager 渲染帧中抽出的原公式）
export const REFERENCE_WATER_LEVEL = 5
export const WATER_LEVEL_DRAFT_FACTOR = 0.1

// 净余水深 = 水位折算高度 - 有效吃水折算深度
export const WATER_HEIGHT_FACTOR = 0.1
export const DRAFT_CLEARANCE_FACTOR = 0.3

// 风险判定阈值
export const WARNING_CLEARANCE_THRESHOLD = 0.5 // 净余水深 < 0.5 触发谨慎通过
export const DANGER_WIND_THRESHOLD = 7 // 风速 >= 7 级触发危险停航

// 载重能力上限（石）：超过上限时风险等级上调一级
export interface ShipTypeLimit {
  maxCargo: number
}

export const SHIP_TYPE_LIMITS: Record<string, ShipTypeLimit> = {
  cargo: { maxCargo: 150 },
  passenger: { maxCargo: 60 },
  fishing: { maxCargo: 30 },
  pleasure: { maxCargo: 20 },
}

// 进度推进：每帧(delta*60) progress += speed * PROGRESS_RATE
export const PROGRESS_RATE = 0.003
// 进度越界回绕：超过 1.1 后回到 -0.1（船舶重新从上游进入）
export const PROGRESS_WRAP_HIGH = 1.1
export const PROGRESS_WRAP_LOW = -0.1
// 对外展示/快照中进度的钳制区间
export const PROGRESS_MIN = 0
export const PROGRESS_MAX = 1

export const STATUS_LABELS: Record<'normal' | 'warning' | 'danger', string> = {
  normal: '正常通行',
  warning: '谨慎通过',
  danger: '危险停航',
}
