/**
 * 推演引擎：从渲染帧中抽出的纯函数核心。
 * 不依赖 React / Three / DOM，可在 Node 中离线执行与批量回放。
 */
import {
  CLEARANCE_DRAFT_FACTOR,
  CLEARANCE_WATER_FACTOR,
  DANGER_WIND_THRESHOLD,
  DEFAULT_WATER_LEVEL,
  DEFAULT_WIND_SPEED,
  DRAFT_WATER_LEVEL_FACTOR,
  PROGRESS_MAX,
  PROGRESS_MIN,
  PROGRESS_SPEED_FACTOR,
  PROGRESS_WRAP_RESET,
  PROGRESS_WRAP_THRESHOLD,
  REFERENCE_WATER_LEVEL,
  WARNING_CLEARANCE_THRESHOLD,
  WATER_LEVEL_MAX,
  WATER_LEVEL_MIN,
  WIND_SPEED_MAX,
  WIND_SPEED_MIN,
} from './constants.ts'
import type {
  FleetEvaluation,
  NavigationStatus,
  OpRecord,
  ShipData,
  ShipEvaluation,
  SimOperation,
  SimState,
} from './types.ts'
import { DEFAULT_SHIPS } from './defaultFleet.ts'

/** 吃水换算：水位低于参考水位时吃水加深，高于时变浅 */
export function computeEffectiveDraft(draft: number, waterLevel: number): number {
  return draft + (REFERENCE_WATER_LEVEL - waterLevel) * DRAFT_WATER_LEVEL_FACTOR
}

/** 通航余量：水位换算值与有效吃水换算值之差 */
export function computeClearance(waterLevel: number, effectiveDraft: number): number {
  return waterLevel * CLEARANCE_WATER_FACTOR - effectiveDraft * CLEARANCE_DRAFT_FACTOR
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 单船航行状态判定（口径与渲染帧中的判定完全一致）：
 * 1. 余量 < 阈值 → warning（优先）
 * 2. 风速 >= 危险阈值 → danger
 * 3. 否则 normal
 * 当前口径下载货量与船型不直接影响判定，仅作为档案数据随结论留痕。
 */
export function evaluateNavigationStatus(
  ship: ShipData,
  waterLevel: number,
  windSpeed: number,
): ShipEvaluation {
  const effectiveDraft = computeEffectiveDraft(ship.draft, waterLevel)
  const clearance = computeClearance(waterLevel, effectiveDraft)
  let status: NavigationStatus
  let rule: ShipEvaluation['rule']
  let reason: string
  if (clearance < WARNING_CLEARANCE_THRESHOLD) {
    status = 'warning'
    rule = 'warning-clearance'
    reason = `余量 ${round3(clearance)} < 阈值 ${WARNING_CLEARANCE_THRESHOLD}（有效吃水 ${round3(effectiveDraft)}，水位 ${waterLevel}）`
  } else if (windSpeed >= DANGER_WIND_THRESHOLD) {
    status = 'danger'
    rule = 'danger-wind'
    reason = `风速 ${windSpeed} >= 危险阈值 ${DANGER_WIND_THRESHOLD}（余量 ${round3(clearance)} 未越限）`
  } else {
    status = 'normal'
    rule = 'normal'
    reason = `余量 ${round3(clearance)} >= 阈值 ${WARNING_CLEARANCE_THRESHOLD} 且风速 ${windSpeed} < ${DANGER_WIND_THRESHOLD}`
  }
  return { shipId: ship.id, effectiveDraft, clearance, status, rule, reason }
}

/** 全船重算：任一输入变化后整体重推，告警 = 是否存在 warning 船舶 */
export function evaluateFleet(
  ships: ShipData[],
  waterLevel: number,
  windSpeed: number,
): FleetEvaluation {
  const evaluations = ships.map((ship) => evaluateNavigationStatus(ship, waterLevel, windSpeed))
  const alertActive = evaluations.some((evaluation) => evaluation.status === 'warning')
  return { evaluations, alertActive }
}

/**
 * 进度推进（与渲染帧一致）：按航速推进，严格大于 1.1 时重置为 -0.1。
 * 越界重置不保留溢出量，重置值恒为 PROGRESS_WRAP_RESET。
 */
export function advanceProgress(progress: number, speed: number, deltaSeconds: number): number {
  const next = progress + speed * PROGRESS_SPEED_FACTOR * deltaSeconds * 60
  return next > PROGRESS_WRAP_THRESHOLD ? PROGRESS_WRAP_RESET : next
}

/** 写回 store 时的进度钳制 */
export function clampProgress(progress: number): number {
  return Math.max(PROGRESS_MIN, Math.min(PROGRESS_MAX, progress))
}

export function validateWaterLevel(level: number): string | null {
  if (typeof level !== 'number' || !Number.isFinite(level)) return `水位 ${level} 不是有限数值`
  if (level < WATER_LEVEL_MIN || level > WATER_LEVEL_MAX)
    return `水位 ${level} 超出允许范围 [${WATER_LEVEL_MIN}, ${WATER_LEVEL_MAX}]`
  return null
}

export function validateWindSpeed(speed: number): string | null {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return `风速 ${speed} 不是有限数值`
  if (speed < WIND_SPEED_MIN || speed > WIND_SPEED_MAX)
    return `风速 ${speed} 超出允许范围 [${WIND_SPEED_MIN}, ${WIND_SPEED_MAX}]`
  return null
}

function cloneShips(ships: ShipData[]): ShipData[] {
  return ships.map((ship) => ({ ...ship }))
}

export interface Simulation {
  /** 应用单个操作；非法操作被拒绝并留痕，状态保持不变 */
  apply: (op: SimOperation) => OpRecord
  /** 当前状态快照（深拷贝，外部修改不影响内部） */
  getState: () => SimState
  /** 基于当前状态的整体重算结论 */
  evaluate: () => FleetEvaluation
  /** 全部操作留痕 */
  getLog: () => OpRecord[]
}

export interface SimulationInit {
  waterLevel?: number
  windSpeed?: number
  ships?: ShipData[]
}

/**
 * 创建一次独立推演。每个操作生效后都会整体重算所有船舶状态与告警，
 * 保证任何时刻的局部结论与全量重算一致。
 */
export function createSimulation(init: SimulationInit = {}): Simulation {
  const state: SimState = {
    waterLevel: init.waterLevel ?? DEFAULT_WATER_LEVEL,
    windSpeed: init.windSpeed ?? DEFAULT_WIND_SPEED,
    selectedShipId: null,
    ships: cloneShips(init.ships ?? DEFAULT_SHIPS),
    alertActive: false,
  }
  const log: OpRecord[] = []

  const recompute = () => {
    const fleet = evaluateFleet(state.ships, state.waterLevel, state.windSpeed)
    state.ships = state.ships.map((ship, index) => ({
      ...ship,
      navigationStatus: fleet.evaluations[index].status,
    }))
    state.alertActive = fleet.alertActive
  }

  const reject = (op: SimOperation, reason: string): OpRecord => {
    const record: OpRecord = { op, applied: false, reason }
    log.push(record)
    return record
  }

  const apply = (op: SimOperation): OpRecord => {
    switch (op.type) {
      case 'setWaterLevel': {
        const error = validateWaterLevel(op.value)
        if (error) return reject(op, error)
        state.waterLevel = op.value
        break
      }
      case 'setWindSpeed': {
        const error = validateWindSpeed(op.value)
        if (error) return reject(op, error)
        state.windSpeed = op.value
        break
      }
      case 'selectShip': {
        const ship = state.ships.find((item) => item.id === op.id)
        if (!ship) return reject(op, `船舶 ${op.id} 不存在，无法选中`)
        // 与点击交互一致：重复选中同一艘船即取消选中
        state.selectedShipId = state.selectedShipId === op.id ? null : op.id
        break
      }
      case 'clearSelection': {
        state.selectedShipId = null
        break
      }
      case 'tick': {
        if (typeof op.deltaSeconds !== 'number' || !Number.isFinite(op.deltaSeconds) || op.deltaSeconds < 0)
          return reject(op, `tick 步长 ${op.deltaSeconds} 非法（须为 >= 0 的有限数值）`)
        state.ships = state.ships.map((ship) => ({
          ...ship,
          progress: advanceProgress(ship.progress, ship.speed, op.deltaSeconds),
        }))
        break
      }
      default: {
        const neverOp: never = op
        return reject(neverOp, `未知操作类型 ${(neverOp as SimOperation).type}`)
      }
    }
    // 任何生效的操作之后都整体重算，保证状态自洽
    recompute()
    const record: OpRecord = { op, applied: true }
    log.push(record)
    return record
  }

  // 初始状态同样先整体重算一次，保证初始结论与推演口径一致
  recompute()

  return {
    apply,
    getState: () => ({
      ...state,
      ships: cloneShips(state.ships),
    }),
    evaluate: () => evaluateFleet(state.ships, state.waterLevel, state.windSpeed),
    getLog: () => log.map((record) => ({ ...record })),
  }
}
