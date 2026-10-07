/**
 * 拼合算法核心（纯函数式状态机，可在任意入口复用）。
 *
 * 职责：
 *  - 碎片集合结构校验（重复 id / 缺失依赖 / 依赖成环）
 *  - 吸附判定（距离与角度双阈值）
 *  - 进度推进（placed 计数、比例）与完成态结算（终态、结算步骤）
 *  - 幂等处理（重复提交不覆盖）、乱序处理（前置未满足时挂起，满足后自动补放）
 *
 * 与 UI 解耦：不依赖 Three.js / DOM / React，输出可观察的事件轨迹与最终结论。
 */

import type {
  AssemblyError,
  AssemblyEvent,
  AssemblyErrorCode,
  AssemblyOperation,
  CompletionState,
  ShardGeometry,
  ShardSet,
  ShardStatus,
  Vec3,
} from "./types.ts";
import { SNAP_ANGLE_DEG, SNAP_DISTANCE } from "./types.ts";

interface PlaceOperation {
  kind: "place";
  shardId: string;
  position: Vec3;
  rotationDeg: number;
}

export interface EngineState {
  set: ShardSet;
  structuralErrors: AssemblyError[];
  status: Map<string, ShardStatus>;
  events: AssemblyEvent[];
  errors: AssemblyError[];
  completion: CompletionState;
  /** 前置依赖未满足而挂起的放置操作（保持提交顺序） */
  deferred: PlaceOperation[];
}

function err(code: AssemblyErrorCode, message: string, shardId?: string): AssemblyError {
  return { code, message, ...(shardId ? { shardId } : {}) };
}

/** 碎片集合结构校验：重复 id、依赖指向缺失、依赖成环 */
export function validateShardSet(set: ShardSet): AssemblyError[] {
  const errors: AssemblyError[] = [];
  const ids = new Set<string>();
  const deps = new Map<string, string[]>();

  for (const shard of set.shards) {
    if (ids.has(shard.id)) {
      errors.push(err("DUPLICATE_SHARD_ID", `碎片 id 重复: ${shard.id}`, shard.id));
    }
    ids.add(shard.id);
  }

  for (const [shardId, prerequisites] of Object.entries(set.dependencies ?? {})) {
    if (!ids.has(shardId)) {
      errors.push(err("DUPLICATE_SHARD_ID", `依赖声明指向未知碎片: ${shardId}`, shardId));
    }
    for (const dep of prerequisites) {
      if (!ids.has(dep)) {
        errors.push(
          err("MISSING_DEPENDENCY", `碎片 ${shardId} 的前置碎片不存在: ${dep}`, shardId),
        );
      }
    }
    deps.set(shardId, prerequisites);
  }

  // DFS 成环检测（仅当依赖图中没有缺失边时）
  if (errors.filter((e) => e.code === "MISSING_DEPENDENCY").length === 0) {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>([...ids].map((id) => [id, WHITE]));
    const stackPath: string[] = [];

    const visit = (id: string): boolean => {
      color.set(id, GRAY);
      stackPath.push(id);
      for (const dep of deps.get(id) ?? []) {
        const depColor = color.get(dep) ?? WHITE;
        if (depColor === GRAY) {
          const cycle = [...stackPath.slice(stackPath.indexOf(dep)), dep];
          errors.push(err("DEPENDENCY_CYCLE", `拼合依赖成环: ${cycle.join(" -> ")}`, dep));
          return true;
        }
        if (depColor === WHITE && visit(dep)) return true;
      }
      stackPath.pop();
      color.set(id, BLACK);
      return false;
    };

    for (const id of ids) {
      if (color.get(id) === WHITE && visit(id)) break;
    }
  }

  return errors;
}

export function createEngine(set: ShardSet): EngineState {
  const structuralErrors = validateShardSet(set);
  const status = new Map<string, ShardStatus>(set.shards.map((s) => [s.id, "pending"]));
  return {
    set,
    structuralErrors,
    status,
    events: [],
    errors: [],
    completion: { complete: false, settledAtStep: null },
    deferred: [],
  };
}

function shardById(state: EngineState, shardId: string): ShardGeometry | undefined {
  return state.set.shards.find((s) => s.id === shardId);
}

function unmetDependencies(state: EngineState, shardId: string): string[] {
  return (state.set.dependencies?.[shardId] ?? []).filter(
    (dep) => state.status.get(dep) !== "placed",
  );
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function angleDiff(a: number, b: number): number {
  let diff = Math.abs(((a - b) % 360) + 360) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/** 吸附判定：距离与角度同时满足阈值 */
export function isSnapPosition(op: PlaceOperation, shard: ShardGeometry): boolean {
  return (
    distance(op.position, shard.target.position) <= SNAP_DISTANCE &&
    angleDiff(op.rotationDeg, shard.target.rotationDeg) <= SNAP_ANGLE_DEG
  );
}

function totalShards(state: EngineState): number {
  return state.set.shards.length;
}

function placedCount(state: EngineState): number {
  return [...state.status.values()].filter((s) => s === "placed").length;
}

function settleCompletionIfDone(state: EngineState, step: number): void {
  if (!state.completion.complete && totalShards(state) > 0 && placedCount(state) === totalShards(state)) {
    state.completion = { complete: true, settledAtStep: step };
    state.events.push({ kind: "completed", step });
  }
}

/** 前置碎片满足后，按提交顺序补放挂起的操作；成功放置会级联触发更多补放 */
function drainDeferred(state: EngineState, step: number): void {
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 0; i < state.deferred.length; ) {
      const op = state.deferred[i];
      if (state.status.get(op.shardId) === "placed") {
        state.deferred.splice(i, 1);
        state.events.push({ kind: "duplicate-ignored", shardId: op.shardId, step });
        moved = true;
        continue;
      }
      if (unmetDependencies(state, op.shardId).length > 0) {
        i++;
        continue;
      }
      state.deferred.splice(i, 1);
      const shard = shardById(state, op.shardId);
      if (shard && isSnapPosition(op, shard)) {
        state.status.set(op.shardId, "placed");
        state.events.push({ kind: "placed", shardId: op.shardId, step });
      } else {
        state.events.push({ kind: "rejected", shardId: op.shardId, step, reason: "misaligned" });
      }
      moved = true;
    }
  }
  settleCompletionIfDone(state, step);
}

function applyPlace(state: EngineState, op: PlaceOperation, step: number): void {
  const shard = shardById(state, op.shardId);
  if (!shard) {
    state.events.push({ kind: "rejected", shardId: op.shardId, step, reason: "unknown-shard" });
    state.errors.push(err("UNKNOWN_SHARD", `提交了集合外碎片: ${op.shardId}`, op.shardId));
    return;
  }
  if (state.status.get(op.shardId) === "placed") {
    // 幂等：重复提交不静默覆盖既有拼合结果
    state.events.push({ kind: "duplicate-ignored", shardId: op.shardId, step });
    return;
  }
  const waitingOn = unmetDependencies(state, op.shardId);
  if (waitingOn.length > 0) {
    // 乱序提交：挂起等待，前置满足后自动补放，最终结论与顺序无关
    state.events.push({ kind: "dependency-waiting", shardId: op.shardId, step, waitingOn });
    state.deferred.push(op);
    return;
  }
  if (isSnapPosition(op, shard)) {
    state.status.set(op.shardId, "placed");
    state.events.push({ kind: "placed", shardId: op.shardId, step });
    settleCompletionIfDone(state, step);
    drainDeferred(state, step);
  } else {
    state.events.push({ kind: "rejected", shardId: op.shardId, step, reason: "misaligned" });
  }
}

function dependentsOf(state: EngineState, shardId: string): string[] {
  // 级联移除：所有（传递）依赖于该碎片的已放置碎片一并取下
  const result: string[] = [];
  const seen = new Set<string>([shardId]);
  let frontier = [shardId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const other of state.set.shards) {
        if (seen.has(other.id)) continue;
        if (state.set.dependencies?.[other.id]?.includes(current)) {
          seen.add(other.id);
          next.push(other.id);
          if (state.status.get(other.id) === "placed") result.push(other.id);
        }
      }
    }
    frontier = next;
  }
  return result;
}

function applyRemove(state: EngineState, shardId: string, step: number): void {
  if (state.completion.complete) {
    state.events.push({ kind: "rejected", shardId, step, reason: "already-complete" });
    return;
  }
  if (!shardById(state, shardId)) {
    state.events.push({ kind: "rejected", shardId, step, reason: "unknown-shard" });
    state.errors.push(err("UNKNOWN_SHARD", `移除了集合外碎片: ${shardId}`, shardId));
    return;
  }
  if (state.status.get(shardId) !== "placed") {
    state.events.push({ kind: "remove-ignored", shardId, step });
    return;
  }
  state.status.set(shardId, "pending");
  state.events.push({ kind: "removed", shardId, step });
  for (const dependentId of dependentsOf(state, shardId)) {
    if (state.status.get(dependentId) === "placed") {
      state.status.set(dependentId, "pending");
      state.events.push({ kind: "removed", shardId: dependentId, step });
    }
  }
}

/** 施加一条拼合操作（完成态为终态，结算后的操作一律拒绝） */
export function applyOperation(state: EngineState, op: AssemblyOperation, step: number): void {
  if (state.structuralErrors.length > 0) return;
  if (state.completion.complete && op.kind === "place") {
    state.events.push({ kind: "rejected", shardId: op.shardId, step, reason: "already-complete" });
    return;
  }
  if (op.kind === "place") {
    applyPlace(state, op, step);
  } else {
    applyRemove(state, op.shardId, step);
  }
}

export function buildConclusion(state: EngineState): import("./types.ts").AssemblyConclusion {
  const total = state.set.shards.length;
  const placed = placedCount(state);
  const shards: Record<string, ShardStatus> = {};
  for (const shard of state.set.shards) shards[shard.id] = state.status.get(shard.id) ?? "pending";
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

/** 对完整操作序列跑一遍引擎 */
export function runEngine(set: ShardSet, operations: AssemblyOperation[]): EngineState {
  const state = createEngine(set);
  operations.forEach((op, index) => applyOperation(state, op, index));
  return state;
}
