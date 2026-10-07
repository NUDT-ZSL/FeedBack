/**
 * 押运推演结算引擎（纯函数、可离线重复运行、无随机数保证结果可复现）。
 *
 * 覆盖结算链路三段：
 *  1. applyEncounter  —— 途中遭遇事件，货物损耗与队伍状态在既有值上累积
 *  2. settleArrival   —— 到达客栈结算，幂等：重复提交返回同一结果、不二次结算
 *  3. traverseRoute   —— 路线推演，遇无法通行 / 缺失节点给出可追溯失败结论
 */

import type {
  EncounterEvent,
  EncounterRecord,
  EscortState,
  RouteFailure,
  RouteNode,
  Settlement,
  SimulationOutcome,
} from './types.ts';

export const BASE_SILVER = 50;
export const CARGO_UNIT_SILVER = 2;

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/** 创建初始队伍状态 */
export function createInitialState(
  teamId: string,
  cargo = 100,
  morale = 80,
  stamina = 100,
): EscortState {
  return {
    teamId,
    cargo,
    initialCargo: cargo,
    morale,
    stamina,
    distanceTraveled: 0,
    eventLog: [],
    settlement: null,
  };
}

/**
 * 处理一次遭遇事件。
 * 货物损耗在当前剩余货物上按比例扣减，士气 / 体力在当前值上累加增量，
 * 多次同类事件因此是累积关系而非互相覆盖。
 */
export function applyEncounter(
  state: EscortState,
  nodeId: string,
  event: EncounterEvent,
): EscortState {
  const cargoAfter = state.cargo * (1 - event.cargoLossRate);
  const moraleAfter = clamp(state.morale + event.moraleDelta);
  const staminaAfter = clamp(state.stamina + event.staminaDelta);

  const record: EncounterRecord = {
    seq: state.eventLog.length + 1,
    nodeId,
    type: event.type,
    cargoAfter,
    moraleAfter,
    staminaAfter,
  };

  return {
    ...state,
    cargo: cargoAfter,
    morale: moraleAfter,
    stamina: staminaAfter,
    eventLog: [...state.eventLog, record],
  };
}

function computeSettlement(state: EscortState): Settlement {
  const silver =
    BASE_SILVER + Math.round(state.cargo * CARGO_UNIT_SILVER) + Math.round(state.morale * 0.5);
  return {
    teamId: state.teamId,
    cargoRemaining: state.cargo,
    morale: state.morale,
    stamina: state.stamina,
    distanceTraveled: state.distanceTraveled,
    eventsHandled: state.eventLog.length,
    silver,
  };
}

/**
 * 到达结算。幂等：同一队伍重复提交时返回首次结算结果，
 * 且不修改任何状态字段（不会被二次结算改写）。
 */
export function settleArrival(state: EscortState): {
  state: EscortState;
  settlement: Settlement;
  repeated: boolean;
} {
  if (state.settlement !== null) {
    return { state, settlement: state.settlement, repeated: true };
  }
  const settlement = computeSettlement(state);
  return { state: { ...state, settlement }, settlement, repeated: false };
}

/**
 * 沿路线推演。
 * - blocked 节点：返回 ROUTE_NODE_IMPASSABLE 失败结论
 * - next 指向缺失节点：返回 ROUTE_NODE_MISSING 失败结论
 * 失败结论包含节点 id、原因与失败前已走路径，绝不静默跳过。
 */
export function traverseRoute(
  start: EscortState,
  nodes: RouteNode[],
  startNodeId: string,
): SimulationOutcome {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: string[] = [];
  let state = start;
  let currentId: string | null = startNodeId;

  while (currentId !== null) {
    const node = byId.get(currentId);
    if (node === undefined) {
      const failure: RouteFailure = {
        code: 'ROUTE_NODE_MISSING',
        nodeId: currentId,
        reason: `路线节点缺失：上一节点指向不存在的节点「${currentId}」`,
        path,
      };
      return { status: 'failed', state, failure };
    }

    path.push(node.id);

    if (node.kind === 'blocked') {
      const failure: RouteFailure = {
        code: 'ROUTE_NODE_IMPASSABLE',
        nodeId: node.id,
        reason: `节点「${node.name}」(${node.id}) 无法通行，推演终止`,
        path,
      };
      return { status: 'failed', state, failure };
    }

    for (const event of node.encounters) {
      state = applyEncounter(state, node.id, event);
    }
    state = { ...state, distanceTraveled: state.distanceTraveled + 1 };

    if (node.kind === 'inn') {
      const settled = settleArrival(state);
      return {
        status: 'arrived',
        state: settled.state,
        settlement: settled.settlement,
      };
    }

    currentId = node.next;
  }

  const failure: RouteFailure = {
    code: 'ROUTE_NODE_MISSING',
    nodeId: '<null>',
    reason: '路线在到达客栈前中断：末节点的 next 为空但终点不是客栈',
    path,
  };
  return { status: 'failed', state, failure };
}
