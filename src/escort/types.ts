/**
 * 押运推演结算链路领域类型。
 * 该模块为纯领域逻辑，不依赖 DOM / React / 网络，可离线运行。
 */

/** 遭遇事件类型：山贼伏击与三类天气 */
export type EncounterType =
  | 'bandit_ambush'
  | 'heavy_rain'
  | 'sandstorm'
  | 'dense_fog';

/** 一次遭遇事件对押运队伍的影响（损耗率与状态增量） */
export interface EncounterEvent {
  type: EncounterType;
  /** 货物损耗率，作用于当前剩余货物（0~1） */
  cargoLossRate: number;
  /** 士气增量（可为负） */
  moraleDelta: number;
  /** 体力增量（可为负） */
  staminaDelta: number;
}

/** 路线节点类型：途经点 / 无法通行 / 终点客栈 */
export type RouteNodeKind = 'waypoint' | 'blocked' | 'inn';

export interface RouteNode {
  id: string;
  name: string;
  kind: RouteNodeKind;
  /** 下一节点 id；inn 节点为 null。指向不存在的 id 视为路线数据缺失 */
  next: string | null;
  /** 经过该节点时依次触发的事件 */
  encounters: EncounterEvent[];
}

/** 已结算的到达结果 */
export interface Settlement {
  teamId: string;
  /** 剩余货物（单位） */
  cargoRemaining: number;
  morale: number;
  stamina: number;
  distanceTraveled: number;
  eventsHandled: number;
  /** 结算镖银（两） */
  silver: number;
}

/** 队伍状态（全程不可变更新，事件影响累积于此） */
export interface EscortState {
  teamId: string;
  cargo: number;
  initialCargo: number;
  morale: number;
  stamina: number;
  distanceTraveled: number;
  /** 已处理事件流水，含每次事件后的累积快照，供追溯 */
  eventLog: EncounterRecord[];
  /** 到达结算结果；已结算后重复结算必须返回同一结果 */
  settlement: Settlement | null;
}

export interface EncounterRecord {
  seq: number;
  nodeId: string;
  type: EncounterType;
  cargoAfter: number;
  moraleAfter: number;
  staminaAfter: number;
}

/** 推演失败结论：带失败码、节点与已走路径，保证可追溯 */
export interface RouteFailure {
  code: 'ROUTE_NODE_IMPASSABLE' | 'ROUTE_NODE_MISSING';
  nodeId: string;
  reason: string;
  /** 失败前已途经的节点 id 序列 */
  path: string[];
}

export type SimulationOutcome =
  | { status: 'arrived'; state: EscortState; settlement: Settlement }
  | { status: 'failed'; state: EscortState; failure: RouteFailure };
