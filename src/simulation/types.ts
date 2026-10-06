export type ShipType = 'cargo' | 'passenger' | 'fishing' | 'pleasure'

export type NavigationStatus = 'normal' | 'warning' | 'danger'

export interface ShipData {
  id: string
  name: string
  type: ShipType
  color: string
  cargo: string
  cargoWeight: number
  draft: number
  speed: number
  progress: number
  navigationStatus: NavigationStatus
}

export interface Environment {
  waterLevel: number
  windSpeed: number
}

// 每一次被拒绝或修正的输入都会留痕，绝不静默跳过
export interface InputViolation {
  tick: number
  field: 'waterLevel' | 'windSpeed' | 'delta' | 'shipId'
  requested: number | string | null
  applied: number | string | null
  reason: string
}

export interface SimulationState {
  tick: number
  waterLevel: number
  windSpeed: number
  ships: ShipData[]
  selectedShipId: string | null
  alertActive: boolean
  violations: InputViolation[]
}

export type SimOp =
  | { type: 'tick'; delta: number }
  | { type: 'setWaterLevel'; value: number }
  | { type: 'setWindSpeed'; value: number }
  | { type: 'selectShip'; id: string | null }
  | { type: 'toggleShip'; id: string }

export interface ShipSnapshot {
  id: string
  name: string
  type: ShipType
  progress: number
  positionX: number
  draft: number
  effectiveDraft: number
  clearance: number
  cargoWeight: number
  speed: number
  navigationStatus: NavigationStatus
}

export interface SimulationSnapshot {
  tick: number
  waterLevel: number
  windSpeed: number
  alertActive: boolean
  selectedShipId: string | null
  violationCount: number
  ships: ShipSnapshot[]
}

// 选中船舶的展示结论：每项结论都附带判定依据，便于比对口径调整前后的差异
export interface ShipReport extends ShipSnapshot {
  statusLabel: string
  basis: string[]
}

export interface ReplayEntry {
  opIndex: number
  op: SimOp
  notes: string[]
  snapshot: SimulationSnapshot
}
