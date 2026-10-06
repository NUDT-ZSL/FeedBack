import {
  applyEnvironment,
  getSimulationSnapshot,
  selectShip,
  stepSimulation,
  toggleShipSelection,
} from './engine'
import { ReplayEntry, SimOp, SimulationState } from './types'

const formatOp = (op: SimOp): string => {
  switch (op.type) {
    case 'tick':
      return `推进 ${op.delta}s`
    case 'setWaterLevel':
      return `设定水位 ${op.value}`
    case 'setWindSpeed':
      return `设定风速 ${op.value}`
    case 'selectShip':
      return op.id === null ? '取消选中' : `选中 ${op.id}`
    case 'toggleShip':
      return `切换选中 ${op.id}`
  }
}

function applyOp(state: SimulationState, op: SimOp): SimulationState {
  switch (op.type) {
    case 'tick':
      return stepSimulation(state, op.delta)
    case 'setWaterLevel':
      return applyEnvironment(state, { waterLevel: op.value })
    case 'setWindSpeed':
      return applyEnvironment(state, { windSpeed: op.value })
    case 'selectShip':
      return selectShip(state, op.id)
    case 'toggleShip':
      return toggleShipSelection(state, op.id)
  }
}

function collectNotes(before: SimulationState, after: SimulationState, op: SimOp): string[] {
  const notes: string[] = [`操作: ${formatOp(op)}`]

  if (op.type === 'setWaterLevel' && before.waterLevel !== after.waterLevel) {
    notes.push(`水位 ${before.waterLevel} → ${after.waterLevel}`)
  }
  if (op.type === 'setWindSpeed' && before.windSpeed !== after.windSpeed) {
    notes.push(`风速 ${before.windSpeed} → ${after.windSpeed}`)
  }
  if (before.selectedShipId !== after.selectedShipId) {
    notes.push(`选中 ${before.selectedShipId ?? '无'} → ${after.selectedShipId ?? '无'}`)
  }

  after.ships.forEach((ship, index) => {
    const prev = before.ships[index]
    if (prev && prev.progress > ship.progress && op.type === 'tick') {
      notes.push(`${ship.name}(${ship.id}) 进度越界回绕 ${prev.progress.toFixed(4)} → ${ship.progress.toFixed(4)}`)
    }
    if (prev && prev.navigationStatus !== ship.navigationStatus) {
      notes.push(`${ship.name}(${ship.id}) 状态 ${prev.navigationStatus} → ${ship.navigationStatus}`)
    }
  })

  if (before.alertActive !== after.alertActive) {
    notes.push(`告警 ${before.alertActive ? '开启' : '关闭'} → ${after.alertActive ? '开启' : '关闭'}`)
  }

  const newViolations = after.violations.slice(before.violations.length)
  newViolations.forEach((violation) => {
    notes.push(`输入越界[${violation.field}]: 请求 ${String(violation.requested)} → ${violation.reason}`)
  })

  return notes
}

export interface ReplayResult {
  state: SimulationState
  entries: ReplayEntry[]
}

/**
 * 离线批量回放：同一初始状态 + 同一操作序列 → 完全确定的最终状态与逐步日志。
 * 每一步都记录操作、状态变化依据与越界输入留痕，便于口径调整前后比对。
 */
export function replaySimulation(initial: SimulationState, ops: SimOp[]): ReplayResult {
  const entries: ReplayEntry[] = []
  let state = initial

  ops.forEach((op, opIndex) => {
    const before = state
    const after = applyOp(before, op)
    entries.push({
      opIndex,
      op,
      notes: collectNotes(before, after, op),
      snapshot: getSimulationSnapshot(after),
    })
    state = after
  })

  return { state, entries }
}
