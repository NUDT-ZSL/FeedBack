/** 推演核心类型：与渲染框架无关，store / 组件 / 离线回放共用。 */

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

/** 推演世界状态：与 gameStore 的状态切片一一对应 */
export interface SimState {
  waterLevel: number
  windSpeed: number
  selectedShipId: string | null
  ships: ShipData[]
  alertActive: boolean
}

/** 可回放操作序列中的单个操作 */
export type SimOperation =
  | { type: 'setWaterLevel'; value: number }
  | { type: 'setWindSpeed'; value: number }
  | { type: 'selectShip'; id: string }
  | { type: 'clearSelection' }
  | { type: 'tick'; deltaSeconds: number }

/** 单个操作的应用结果（被拒绝的异常输入也会留痕，不允许静默跳过） */
export interface OpRecord {
  op: SimOperation
  applied: boolean
  /** 拒绝原因（applied=false 时必有值） */
  reason?: string
}

/** 单船状态判定依据：每条结论都能回溯到具体数值与阈值 */
export interface ShipEvaluation {
  shipId: string
  effectiveDraft: number
  clearance: number
  status: NavigationStatus
  rule: 'warning-clearance' | 'danger-wind' | 'normal'
  reason: string
}

/** 一次全船重算的结果 */
export interface FleetEvaluation {
  evaluations: ShipEvaluation[]
  alertActive: boolean
}

/** 回放轨迹中的一步：操作 + 应用结果 + 操作后快照 + 判定依据 */
export interface StepTrace {
  step: number
  record: OpRecord
  state: SimState
  evaluation: FleetEvaluation
}

export interface Scenario {
  name: string
  description: string
  initial?: {
    waterLevel?: number
    windSpeed?: number
    ships?: ShipData[]
  }
  operations: SimOperation[]
}

export interface ReplayResult {
  scenario: string
  description: string
  steps: StepTrace[]
  finalState: SimState
  /** 对整段归一化轨迹的确定性摘要，用于口径调整前后的差异比对 */
  checksum: string
}
