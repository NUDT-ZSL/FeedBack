/**
 * 推演口径常量：所有阈值与换算系数集中在此，调整口径只改这里。
 * 渲染层（BridgeScene/ShipManager）与离线推演（replay/tests）共用同一份定义。
 */

/** 水位允许范围（丈），对应 UI 滑条 0-10 */
export const WATER_LEVEL_MIN = 0
export const WATER_LEVEL_MAX = 10
/** 风速允许范围（级），对应 UI 旋钮 0-8 */
export const WIND_SPEED_MIN = 0
export const WIND_SPEED_MAX = 8

/** 默认水位 / 风速 */
export const DEFAULT_WATER_LEVEL = 5
export const DEFAULT_WIND_SPEED = 2

/** 吃水换算的参考水位：effectiveDraft = draft + (REFERENCE_WATER_LEVEL - waterLevel) * DRAFT_WATER_LEVEL_FACTOR */
export const REFERENCE_WATER_LEVEL = 5
export const DRAFT_WATER_LEVEL_FACTOR = 0.1

/** 通航余量：clearance = waterLevel * CLEARANCE_WATER_FACTOR - effectiveDraft * CLEARANCE_DRAFT_FACTOR */
export const CLEARANCE_WATER_FACTOR = 0.1
export const CLEARANCE_DRAFT_FACTOR = 0.3

/** 余量低于该值判定为 warning（严格小于） */
export const WARNING_CLEARANCE_THRESHOLD = 0.5
/** 风速达到该值判定为 danger（大于等于；warning 判定优先于 danger） */
export const DANGER_WIND_THRESHOLD = 7

/** 进度推进：progress += speed * PROGRESS_SPEED_FACTOR * deltaSeconds * 60 */
export const PROGRESS_SPEED_FACTOR = 0.003
/** 进度超过该值（严格大于）时重置为 PROGRESS_WRAP_RESET */
export const PROGRESS_WRAP_THRESHOLD = 1.1
export const PROGRESS_WRAP_RESET = -0.1
/** 进度合法区间（写入 store 时的钳制范围） */
export const PROGRESS_MIN = 0
export const PROGRESS_MAX = 1
