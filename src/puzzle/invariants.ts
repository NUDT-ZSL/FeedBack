/**
 * 拼合结论不变量审计：独立检查“事件轨迹 / 进度 / 完成态 / 最终碎片状态”是否互相印证。
 * 引擎自身产出的结论必须审计通过；被污染或伪造的结论必须被明确指出失真位置。
 */

import type { AssemblyConclusion, AssemblyEvent, ShardSet } from "./types.ts";

export type InvariantCode =
  | "PROGRESS_COUNT_MISMATCH"
  | "PROGRESS_RATIO_MISMATCH"
  | "PROGRESS_COMPLETION_MISMATCH"
  | "COMPLETION_EVENT_MISMATCH"
  | "DEPENDENCY_VIOLATION"
  | "PLACED_EVENT_LEDGER_MISMATCH";

export interface InvariantFailure {
  code: InvariantCode;
  message: string;
}

function failure(code: InvariantCode, message: string): InvariantFailure {
  return { code, message };
}

/** 由事件轨迹独立模拟碎片状态账本，检测轨迹内部是否自相矛盾 */
function auditEventLedger(
  set: ShardSet,
  events: AssemblyEvent[],
): { ledger: Map<string, number>; failures: InvariantFailure[] } {
  const status = new Map<string, "pending" | "placed">(set.shards.map((s) => [s.id, "pending"]));
  const failures: InvariantFailure[] = [];

  for (const event of events) {
    if (event.kind === "placed") {
      if (status.get(event.shardId) === "placed") {
        failures.push(
          failure(
            "PLACED_EVENT_LEDGER_MISMATCH",
            `碎片 ${event.shardId} 在步骤 ${event.step} 未先移除却被重复记为已拼合`,
          ),
        );
      }
      status.set(event.shardId, "placed");
    } else if (event.kind === "removed") {
      if (status.get(event.shardId) !== "placed") {
        failures.push(
          failure(
            "PLACED_EVENT_LEDGER_MISMATCH",
            `碎片 ${event.shardId} 在步骤 ${event.step} 未处于已拼合状态却出现移除事件`,
          ),
        );
      }
      status.set(event.shardId, "pending");
    }
  }

  const counts = new Map<string, number>();
  for (const shard of set.shards) counts.set(shard.id, status.get(shard.id) === "placed" ? 1 : 0);
  return { ledger: counts, failures };
}

export function auditConclusion(
  set: ShardSet,
  conclusion: AssemblyConclusion,
): InvariantFailure[] {
  const failures: InvariantFailure[] = [];
  const total = set.shards.length;
  const placedIds = Object.entries(conclusion.shards)
    .filter(([, status]) => status === "placed")
    .map(([id]) => id);
  const placed = placedIds.length;

  if (conclusion.progress.placed !== placed || conclusion.progress.total !== total) {
    failures.push(
      failure(
        "PROGRESS_COUNT_MISMATCH",
        `进度计数为 ${conclusion.progress.placed}/${conclusion.progress.total}，实际碎片状态为 ${placed}/${total}`,
      ),
    );
  }

  const expectedRatio = total > 0 ? placed / total : 0;
  if (Math.abs(conclusion.progress.ratio - expectedRatio) > 1e-9) {
    failures.push(
      failure(
        "PROGRESS_RATIO_MISMATCH",
        `进度比例为 ${conclusion.progress.ratio}，按状态计算应为 ${expectedRatio}`,
      ),
    );
  }

  const shouldBeComplete = total > 0 && placed === total;
  if (conclusion.completion.complete !== shouldBeComplete) {
    failures.push(
      failure(
        "PROGRESS_COMPLETION_MISMATCH",
        shouldBeComplete
          ? "全部碎片已拼合但完成态未结算"
          : `完成态声称已结算，但已拼合碎片为 ${placed}/${total}`,
      ),
    );
  }

  const completedEvents = conclusion.events.filter((event) => event.kind === "completed");
  if (completedEvents.length > 1) {
    failures.push(
      failure(
        "COMPLETION_EVENT_MISMATCH",
        `事件轨迹中出现 ${completedEvents.length} 次完成结算，至多允许 1 次`,
      ),
    );
  }
  if (conclusion.completion.complete) {
    if (completedEvents.length !== 1) {
      failures.push(
        failure("COMPLETION_EVENT_MISMATCH", "完成态已结算但事件轨迹缺少完成事件"),
      );
    } else if (completedEvents[0].step !== conclusion.completion.settledAtStep) {
      failures.push(
        failure(
          "COMPLETION_EVENT_MISMATCH",
          `完成态结算步骤为 ${conclusion.completion.settledAtStep}，完成事件发生在步骤 ${completedEvents[0].step}`,
        ),
      );
    }
  } else if (conclusion.completion.settledAtStep !== null || completedEvents.length > 0) {
    failures.push(
      failure(
        "COMPLETION_EVENT_MISMATCH",
        "完成态声称未结算，但存在结算步骤或完成事件",
      ),
    );
  }

  // 依赖一致性：已拼合碎片的前置碎片必须全部已拼合
  for (const shardId of placedIds) {
    const missing = (set.dependencies?.[shardId] ?? []).filter(
      (dep) => conclusion.shards[dep] !== "placed",
    );
    if (missing.length > 0) {
      failures.push(
        failure(
          "DEPENDENCY_VIOLATION",
          `碎片 ${shardId} 已拼合，但其前置碎片未拼合: ${missing.join(", ")}`,
        ),
      );
    }
  }

  // 事件账本：placed/removed 轨迹必须与最终状态一致且内部不矛盾
  const { ledger, failures: ledgerFailures } = auditEventLedger(set, conclusion.events);
  failures.push(...ledgerFailures);
  for (const [shardId, ledgerPlaced] of ledger) {
    const finalPlaced = conclusion.shards[shardId] === "placed" ? 1 : 0;
    if (ledgerPlaced !== finalPlaced) {
      failures.push(
        failure(
          "PLACED_EVENT_LEDGER_MISMATCH",
          `碎片 ${shardId} 的事件账本(${ledgerPlaced ? "已拼合" : "未拼合"})与最终状态(${
            finalPlaced ? "已拼合" : "未拼合"
          })不一致`,
        ),
      );
    }
  }

  return failures;
}
