import {
  DEFAULT_WATER_LEVEL,
  DEFAULT_WIND_SPEED,
  DANGER_WIND_THRESHOLD,
  DRAFT_CLEARANCE_FACTOR,
  PROGRESS_MAX,
  PROGRESS_MIN,
  PROGRESS_RATE,
  PROGRESS_WRAP_HIGH,
  PROGRESS_WRAP_LOW,
  REFERENCE_WATER_LEVEL,
  RIVER_LENGTH,
  SHIP_TYPE_LIMITS,
  STATUS_LABELS,
  WARNING_CLEARANCE_THRESHOLD,
  WATER_HEIGHT_FACTOR,
  WATER_LEVEL_DRAFT_FACTOR,
  WATER_LEVEL_MAX,
  WATER_LEVEL_MIN,
  WIND_SPEED_MAX,
  WIND_SPEED_MIN,
} from './constants'
import {
  Environment,
  InputViolation,
  NavigationStatus,
  ShipData,
  ShipReport,
  ShipSnapshot,
  ShipType,
  SimulationSnapshot,
  SimulationState,
} from './types'

const round6 = (value: number): number => Number(value.toFixed(6))

// ---------------------------------------------------------------------------
// 纯函数：吃水换算与风险判定（推演口径的唯一来源）
// ---------------------------------------------------------------------------

export function computeEffectiveDraft(draft: number, waterLevel: number): number {
  return draft + (REFERENCE_WATER_LEVEL - waterLevel) * WATER_LEVEL_DRAFT_FACTOR
}

export function computeClearance(draft: number, waterLevel: number): number {
  const effectiveDraft = computeEffectiveDraft(draft, waterLevel)
  return waterLevel * WATER_HEIGHT_FACTOR - effectiveDraft * DRAFT_CLEARANCE_FACTOR
}

export function getMaxCargo(type: ShipType): number {
  return SHIP_TYPE_LIMITS[type]?.maxCargo ?? Infinity
}

export function isOverloaded(ship: Pick<ShipData, 'type' | 'cargoWeight'>): boolean {
  return ship.cargoWeight > getMaxCargo(ship.type)
}

const escalate = (status: NavigationStatus): NavigationStatus =>
  status === 'normal' ? 'warning' : 'danger'

/**
 * 风险判定（与渲染帧中抽出的口径一致，并补充载重/船型耦合）：
 * 1. 净余水深 < 0.5 → 谨慎通过（warning 优先于风速判定）
 * 2. 风速 >= 7 级 → 危险停航
 * 3. 其余 → 正常通行
 * 4. 载重超过船型上限 → 在上述结果基础上上调一级
 */
export function evaluateNavigationStatus(
  ship: Pick<ShipData, 'draft' | 'type' | 'cargoWeight'>,
  env: Environment,
): NavigationStatus {
  const clearance = computeClearance(ship.draft, env.waterLevel)
  let status: NavigationStatus
  if (clearance < WARNING_CLEARANCE_THRESHOLD) {
    status = 'warning'
  } else if (env.windSpeed >= DANGER_WIND_THRESHOLD) {
    status = 'danger'
  } else {
    status = 'normal'
  }
  if (isOverloaded(ship)) {
    status = escalate(status)
  }
  return status
}

// 告警口径：任一船舶处于 warning 即触发桥头红旗告警（与渲染帧原逻辑一致）
export function computeAlertActive(ships: Pick<ShipData, 'navigationStatus'>[]): boolean {
  return ships.some((ship) => ship.navigationStatus === 'warning')
}

// ---------------------------------------------------------------------------
// 进度推进与边界重置
// ---------------------------------------------------------------------------

export function advanceProgress(speed: number, progress: number, delta: number): number {
  let next = progress + speed * PROGRESS_RATE * delta * 60
  if (next > PROGRESS_WRAP_HIGH) {
    next = PROGRESS_WRAP_LOW
  }
  return next
}

export function clampProgress(progress: number): number {
  return Math.max(PROGRESS_MIN, Math.min(PROGRESS_MAX, progress))
}

// ---------------------------------------------------------------------------
// 输入归一化：越界输入被钳制/拒绝并留痕，绝不静默跳过
// ---------------------------------------------------------------------------

interface NormalizedNumber {
  value: number
  violation: Pick<InputViolation, 'requested' | 'applied' | 'reason'> | null
}

function normalizeNumber(
  raw: number,
  min: number,
  max: number,
  current: number,
  label: string,
): NormalizedNumber {
  if (typeof raw !== 'number' || Number.isNaN(raw) || !Number.isFinite(raw)) {
    return {
      value: current,
      violation: {
        requested: String(raw),
        applied: current,
        reason: `${label} 输入非有限数值，已拒绝并保持当前值`,
      },
    }
  }
  if (raw < min || raw > max) {
    const clamped = Math.max(min, Math.min(max, raw))
    return {
      value: clamped,
      violation: {
        requested: raw,
        applied: clamped,
        reason: `${label} 超出允许范围 [${min}, ${max}]，已钳制`,
      },
    }
  }
  return { value: raw, violation: null }
}

export function normalizeWaterLevel(raw: number, current: number): NormalizedNumber {
  return normalizeNumber(raw, WATER_LEVEL_MIN, WATER_LEVEL_MAX, current, '水位')
}

export function normalizeWindSpeed(raw: number, current: number): NormalizedNumber {
  return normalizeNumber(raw, WIND_SPEED_MIN, WIND_SPEED_MAX, current, '风速')
}

// ---------------------------------------------------------------------------
// 推演状态转移：所有操作都以整体重算收尾，保证局部结论与全局一致
// ---------------------------------------------------------------------------

function recalculate(state: SimulationState): SimulationState {
  const env: Environment = { waterLevel: state.waterLevel, windSpeed: state.windSpeed }
  const ships = state.ships.map((ship) => {
    const navigationStatus = evaluateNavigationStatus(ship, env)
    return navigationStatus === ship.navigationStatus ? ship : { ...ship, navigationStatus }
  })
  return { ...state, ships, alertActive: computeAlertActive(ships) }
}

export function createSimulation(options?: {
  ships?: ShipData[]
  waterLevel?: number
  windSpeed?: number
}): SimulationState {
  let state: SimulationState = {
    tick: 0,
    waterLevel: DEFAULT_WATER_LEVEL,
    windSpeed: DEFAULT_WIND_SPEED,
    ships: (options?.ships ?? []).map((ship) => ({ ...ship })),
    selectedShipId: null,
    alertActive: false,
    violations: [],
  }
  const envInput: { waterLevel?: number; windSpeed?: number } = {}
  if (options?.waterLevel !== undefined) envInput.waterLevel = options.waterLevel
  if (options?.windSpeed !== undefined) envInput.windSpeed = options.windSpeed
  state = applyEnvironment(state, envInput)
  return state
}

export function applyEnvironment(
  state: SimulationState,
  input: { waterLevel?: number; windSpeed?: number },
): SimulationState {
  const violations: InputViolation[] = []
  let { waterLevel, windSpeed } = state

  if (input.waterLevel !== undefined) {
    const normalized = normalizeWaterLevel(input.waterLevel, state.waterLevel)
    waterLevel = normalized.value
    if (normalized.violation) {
      violations.push({ tick: state.tick, field: 'waterLevel', ...normalized.violation })
    }
  }
  if (input.windSpeed !== undefined) {
    const normalized = normalizeWindSpeed(input.windSpeed, state.windSpeed)
    windSpeed = normalized.value
    if (normalized.violation) {
      violations.push({ tick: state.tick, field: 'windSpeed', ...normalized.violation })
    }
  }

  return recalculate({
    ...state,
    waterLevel,
    windSpeed,
    violations: [...state.violations, ...violations],
  })
}

export function stepSimulation(state: SimulationState, delta: number): SimulationState {
  if (typeof delta !== 'number' || Number.isNaN(delta) || !Number.isFinite(delta) || delta <= 0) {
    const violation: InputViolation = {
      tick: state.tick,
      field: 'delta',
      requested: typeof delta === 'number' ? delta : String(delta),
      applied: null,
      reason: '推进步长必须为正有限数值，本步已拒绝推进',
    }
    // 不推进、不静默：状态仍整体重算一次，保证结论自洽
    return recalculate({ ...state, violations: [...state.violations, violation] })
  }
  const advanced = state.ships.map((ship) => ({
    ...ship,
    progress: advanceProgress(ship.speed, ship.progress, delta),
  }))
  return recalculate({ ...state, tick: state.tick + 1, ships: advanced })
}

export function selectShip(state: SimulationState, id: string | null): SimulationState {
  if (id === null) {
    return { ...state, selectedShipId: null }
  }
  if (!state.ships.some((ship) => ship.id === id)) {
    const violation: InputViolation = {
      tick: state.tick,
      field: 'shipId',
      requested: id,
      applied: state.selectedShipId,
      reason: `船舶 ${id} 不存在，选中请求已拒绝`,
    }
    return { ...state, violations: [...state.violations, violation] }
  }
  return { ...state, selectedShipId: id }
}

// 与 UI 点击语义一致：再次点击同一船舶取消选中
export function toggleShipSelection(state: SimulationState, id: string): SimulationState {
  if (state.selectedShipId === id) {
    return selectShip(state, null)
  }
  return selectShip(state, id)
}

// ---------------------------------------------------------------------------
// 快照与结论：确定性、可序列化、每项结论附带依据
// ---------------------------------------------------------------------------

export function getShipSnapshot(ship: ShipData, env: Environment): ShipSnapshot {
  return {
    id: ship.id,
    name: ship.name,
    type: ship.type,
    progress: round6(clampProgress(ship.progress)),
    positionX: round6((clampProgress(ship.progress) - 0.5) * RIVER_LENGTH),
    draft: ship.draft,
    effectiveDraft: round6(computeEffectiveDraft(ship.draft, env.waterLevel)),
    clearance: round6(computeClearance(ship.draft, env.waterLevel)),
    cargoWeight: ship.cargoWeight,
    speed: ship.speed,
    navigationStatus: ship.navigationStatus,
  }
}

export function getSimulationSnapshot(state: SimulationState): SimulationSnapshot {
  const env: Environment = { waterLevel: state.waterLevel, windSpeed: state.windSpeed }
  return {
    tick: state.tick,
    waterLevel: state.waterLevel,
    windSpeed: state.windSpeed,
    alertActive: state.alertActive,
    selectedShipId: state.selectedShipId,
    violationCount: state.violations.length,
    ships: state.ships.map((ship) => getShipSnapshot(ship, env)),
  }
}

export function getShipReport(state: SimulationState, id: string): ShipReport | null {
  const ship = state.ships.find((s) => s.id === id)
  if (!ship) return null
  const env: Environment = { waterLevel: state.waterLevel, windSpeed: state.windSpeed }
  const snapshot = getShipSnapshot(ship, env)

  const basis: string[] = []
  const clearance = computeClearance(ship.draft, env.waterLevel)
  const effectiveDraft = computeEffectiveDraft(ship.draft, env.waterLevel)
  basis.push(
    `有效吃水 = ${ship.draft} + (${REFERENCE_WATER_LEVEL} - ${env.waterLevel}) × ${WATER_LEVEL_DRAFT_FACTOR} = ${round6(effectiveDraft)}`,
  )
  basis.push(
    `净余水深 = ${env.waterLevel} × ${WATER_HEIGHT_FACTOR} - ${round6(effectiveDraft)} × ${DRAFT_CLEARANCE_FACTOR} = ${round6(clearance)}`,
  )
  if (clearance < WARNING_CLEARANCE_THRESHOLD) {
    basis.push(`净余水深 ${round6(clearance)} < ${WARNING_CLEARANCE_THRESHOLD} → 谨慎通过`)
  } else if (env.windSpeed >= DANGER_WIND_THRESHOLD) {
    basis.push(`风速 ${env.windSpeed} ≥ ${DANGER_WIND_THRESHOLD} 级 → 危险停航`)
  } else {
    basis.push(
      `净余水深 ${round6(clearance)} ≥ ${WARNING_CLEARANCE_THRESHOLD} 且风速 ${env.windSpeed} < ${DANGER_WIND_THRESHOLD} 级 → 正常通行`,
    )
  }
  if (isOverloaded(ship)) {
    basis.push(
      `载重 ${ship.cargoWeight} 石超过船型上限 ${getMaxCargo(ship.type)} 石 → 风险上调一级`,
    )
  }

  return {
    ...snapshot,
    statusLabel: STATUS_LABELS[ship.navigationStatus],
    basis,
  }
}
