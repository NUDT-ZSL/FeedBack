/**
 * 拼合链路的两个驱动入口，语义必须一致（同一碎片集合 + 同一操作序列 -> 同一结论）：
 *
 * 1. runInteractiveEntry：交互入口（对应页面拖拽），逐条 dispatch 到有状态会话上，
 *    结论来自会话维护的实时状态。
 * 2. runBatchEntry：批量/回放入口（对应离线复现），独立重放一遍引擎，并且最终结论
 *    只由事件轨迹反推（事件日志 -> 状态/进度/完成态），不直接读取引擎内部状态。
 *
 * 两个入口结论的逐字段一致性由 verify/run.ts 批量校验，防止任一入口静默分叉。
 */

import {
  applyOperation,
  createEngine,
  runEngine,
  type EngineState,
} from "./engine.ts";
import type {
  AssemblyConclusion,
  AssemblyEvent,
  AssemblyOperation,
  CompletionState,
  ShardSet,
  ShardStatus,
} from "./types.ts";

/** 交互入口：有状态会话，模拟页面上逐次拖拽释放 */
export class AssemblySession {
  private state: EngineState;
  private cursor = 0;

  constructor(set: ShardSet) {
    this.state = createEngine(set);
  }

  dispatch(op: AssemblyOperation): void {
    applyOperation(this.state, op, this.cursor);
    this.cursor += 1;
  }

  getConclusion(): AssemblyConclusion {
    return conclusionFromEngineState(this.state);
  }
}

function conclusionFromEngineState(state: EngineState): AssemblyConclusion {
  const total = state.set.shards.length;
  let placed = 0;
  const shards: Record<string, ShardStatus> = {};
  for (const shard of state.set.shards) {
    const status = state.status.get(shard.id) ?? "pending";
    if (status === "placed") placed += 1;
    shards[shard.id] = status;
  }
  return {
    vesselId: state.set.vesselId,
    valid: state.structuralErrors.length === 0,
    shards,
    progress: { placed, total, ratio: total > 0 ? placed / total : 0 },
    completion: state.completion,
    events: state.events,
    errors: [...state.structuralErrors, ...state.errors],
  };
}

export function runInteractiveEntry(set: ShardSet, operations: AssemblyOperation[]): AssemblyConclusion {
  const session = new AssemblySession(set);
  for (const op of operations) session.dispatch(op);
  return session.getConclusion();
}

/** 批量入口：独立跑一遍引擎后，仅依据事件轨迹重放出最终结论 */
export function runBatchEntry(set: ShardSet, operations: AssemblyOperation[]): AssemblyConclusion {
  const state = runEngine(set, operations);
  return replayConclusionFromEvents(set, state.events, state.structuralErrors, state.errors);
}

/** 事件轨迹 -> 结论：如果实时状态是真实的，就必须能由事件流完整重放出来 */
export function replayConclusionFromEvents(
  set: ShardSet,
  events: AssemblyEvent[],
  structuralErrors: AssemblyConclusion["errors"],
  runtimeErrors: AssemblyConclusion["errors"],
): AssemblyConclusion {
  const status = new Map<string, ShardStatus>(set.shards.map((s) => [s.id, "pending"]));
  let completion: CompletionState = { complete: false, settledAtStep: null };

  for (const event of events) {
    switch (event.kind) {
      case "placed":
        status.set(event.shardId, "placed");
        break;
      case "removed":
        status.set(event.shardId, "pending");
        break;
      case "completed":
        completion = { complete: true, settledAtStep: event.step };
        break;
      default:
        break;
    }
  }

  const total = set.shards.length;
  let placed = 0;
  const shards: Record<string, ShardStatus> = {};
  for (const shard of set.shards) {
    const shardStatus = status.get(shard.id) ?? "pending";
    if (shardStatus === "placed") placed += 1;
    shards[shard.id] = shardStatus;
  }

  return {
    vesselId: set.vesselId,
    valid: structuralErrors.length === 0,
    shards,
    progress: { placed, total, ratio: total > 0 ? placed / total : 0 },
    completion,
    events,
    errors: [...structuralErrors, ...runtimeErrors],
  };
}
