/**
 * 押运推演核心领域类型。
 * 全部为纯数据结构，不依赖 DOM / 网络 / 外部服务，可在 Node 环境离线运行。
 */

export type ConvoyStatus = "en_route" | "arrived" | "failed";

export type CargoCondition = "intact" | "damaged" | "lost";

export interface CargoItem {
  id: string;
  name: string;
  /** 剩余数量，遭遇事件会按比率损耗 */
  quantity: number;
  /** 初始数量，用于结算时核算累计损耗 */
  initialQuantity: number;
  /** 单件价值（两） */
  unitValue: number;
  condition: CargoCondition;
}

export interface ConvoyState {
  id: string;
  status: ConvoyStatus;
  /** 士气 0-100 */
  morale: number;
  /** 体力 0-100 */
  stamina: number;
  /** 镖师人数 */
  guards: number;
  cargo: CargoItem[];
  /** 已行进路程 */
  distance: number;
  /** 随身镖银（两） */
  silver: number;
  /** 推演轨迹，用于失败追溯 */
  trace: string[];
}

export type EncounterKind =
  | "bandit_ambush"
  | "cargo_spoilage"
  | "storm"
  | "toll";

export interface EncounterEvent {
  kind: EncounterKind;
  /** 货物损耗比率（按当前存量计算，多次遭遇会复利式累积） */
  cargoLossRate?: number;
  moraleDelta?: number;
  staminaDelta?: number;
  guardLoss?: number;
  silverDelta?: number;
}

export type RouteNodeKind = "waypoint" | "impassable" | "destination";

export interface RouteNode {
  id: string;
  kind: RouteNodeKind;
}

export interface RouteEdge {
  from: string;
  to: string;
  distance: number;
  /** 途经该路段时依次触发的遭遇事件 */
  encounters?: EncounterEvent[];
}

export interface RouteGraph {
  nodes: RouteNode[];
  edges: RouteEdge[];
  start: string;
  destination: string;
}

export type FailureCode =
  | "DANGLING_EDGE"
  | "MISSING_NODE"
  | "UNREACHABLE_DESTINATION"
  | "IMPASSABLE_NODE"
  | "DEAD_END"
  | "INVALID_STATE";

export interface FailureReport {
  code: FailureCode;
  message: string;
  /** 失败发生时已走过的节点路径 */
  visitedPath: string[];
  /** 出问题的节点 / 边，便于定位 */
  nodeIds?: string[];
  edge?: RouteEdge;
}

export interface SettlementRecord {
  convoyId: string;
  /** 一次到达的唯一标识，幂等键的一部分 */
  arrivalId: string;
  cargoValueDelivered: number;
  cargoValueLost: number;
  reward: number;
  finalSilver: number;
  guardsRemaining: number;
}
