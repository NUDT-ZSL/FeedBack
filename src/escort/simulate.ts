/**
 * 押运推演统一运行入口（离线、纯函数、无外部服务）。
 *
 * 所有验证场景都通过 runEscortSimulation 执行：
 * 走完路线 -> 顺序叠加遭遇事件 -> 到达 -> 幂等结算；
 * 任一环节失败都以 FailureReport 形式返回，绝不静默跳过。
 */
import { applyEncounters } from "./events.ts";
import { walkRoute } from "./route.ts";
import { SettlementError, SettlementLedger } from "./settlement.ts";
import type {
  ConvoyState,
  FailureReport,
  RouteGraph,
  SettlementRecord,
} from "./types.ts";

export interface SimulationInput {
  convoy: ConvoyState;
  route: RouteGraph;
  arrivalId: string;
  /** 可选：跨多次推演共享同一本结算账，用于验证重复提交 */
  ledger?: SettlementLedger;
}

export interface SimulationResult {
  ok: boolean;
  finalState: ConvoyState;
  settlement?: SettlementRecord;
  failure?: FailureReport;
}

const toFailure = (
  state: ConvoyState,
  failure: FailureReport,
): SimulationResult => {
  const finalState: ConvoyState = {
    ...state,
    status: "failed",
    trace: [...state.trace, failure.message],
  };
  return { ok: false, finalState, failure };
};

export function runEscortSimulation(input: SimulationInput): SimulationResult {
  const ledger = input.ledger ?? new SettlementLedger();
  let state: ConvoyState = {
    ...input.convoy,
    trace: [...input.convoy.trace, `推演开始 镖队=${input.convoy.id}`],
  };

  const walked = walkRoute(input.route);
  if ("failure" in walked) {
    return toFailure(state, walked.failure);
  }

  for (const [index, edge] of walked.edges.entries()) {
    state = {
      ...state,
      distance: state.distance + edge.distance,
      trace: [...state.trace, `路段${index + 1} ${edge.from} -> ${edge.to}`],
    };
    if (edge.encounters) {
      state = applyEncounters(state, edge.encounters, `路段${index + 1}`);
    }
  }

  state = { ...state, status: "arrived", trace: [...state.trace, "抵达目的地"] };

  try {
    const settled = ledger.settle(state, input.arrivalId);
    const { record, ...finalState } = settled;
    return { ok: true, finalState, settlement: record };
  } catch (error) {
    const report: FailureReport = {
      code: "INVALID_STATE",
      message: error instanceof SettlementError ? error.message : String(error),
      visitedPath: [input.route.start],
    };
    return toFailure(state, report);
  }
}
