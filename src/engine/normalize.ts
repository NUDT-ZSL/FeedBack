import {
  DataIssue,
  NormEvent,
  StreamEvent,
  UNKNOWN_SOURCE,
} from "./types";

/**
 * 事件规范化：
 * - 乱序到达：按 (arrivalTime, inputIndex) 稳定排序，保证同时刻事件顺序确定；
 * - 来源缺失：归入 UNKNOWN_SOURCE 保留来源并记录 MISSING_SOURCE；
 * - id 缺失：按确定性规则生成 evt#<inputIndex> 并记录 MISSING_ID；
 * - 非法时刻（NaN/非有限）：记录 INVALID_TIME 并剔除（显式剔除，非静默）；
 * - 负时刻：记录 NEGATIVE_TIME，按 0 处理；
 * - id 重复：记录 DUPLICATE_ID，后者以确定性后缀区分。
 */
export function normalizeEvents(raw: StreamEvent[]): {
  events: NormEvent[];
  issues: DataIssue[];
} {
  const issues: DataIssue[] = [];
  const seen = new Set<string>();
  const events: NormEvent[] = [];

  raw.forEach((e, inputIndex) => {
    let id = e.id;
    if (id === undefined || id === null || id === "") {
      id = `evt#${inputIndex}`;
      issues.push({
        code: "MISSING_ID",
        message: `事件缺少 id，按输入顺序生成 ${id}`,
        eventIndex: inputIndex,
        eventId: id,
      });
    }
    if (seen.has(id)) {
      const dedup = `${id}~dup${inputIndex}`;
      issues.push({
        code: "DUPLICATE_ID",
        message: `事件 id "${id}" 重复，重命名为 ${dedup}`,
        eventIndex: inputIndex,
        eventId: dedup,
      });
      id = dedup;
    }
    seen.add(id);

    let arrivalTime = e.arrivalTime;
    if (typeof arrivalTime !== "number" || !Number.isFinite(arrivalTime)) {
      issues.push({
        code: "INVALID_TIME",
        message: `事件 ${id} 到达时刻非法（${String(arrivalTime)}），已显式剔除`,
        eventIndex: inputIndex,
        eventId: id,
      });
      return;
    }
    if (arrivalTime < 0) {
      issues.push({
        code: "NEGATIVE_TIME",
        message: `事件 ${id} 到达时刻为负（${arrivalTime}），按 0 处理`,
        eventIndex: inputIndex,
        eventId: id,
      });
      arrivalTime = 0;
    }

    let sourceId = e.sourceId;
    if (sourceId === undefined || sourceId === null || sourceId === "") {
      sourceId = UNKNOWN_SOURCE;
      issues.push({
        code: "MISSING_SOURCE",
        message: `事件 ${id} 缺少来源标识，归入保留来源 ${UNKNOWN_SOURCE}`,
        eventIndex: inputIndex,
        eventId: id,
      });
    }

    events.push({ id, sourceId, arrivalTime, payload: e.payload, inputIndex });
  });

  events.sort((a, b) =>
    a.arrivalTime === b.arrivalTime
      ? a.inputIndex - b.inputIndex
      : a.arrivalTime - b.arrivalTime,
  );
  return { events, issues };
}

/**
 * 对指定来源的到达速率做等比缩放（factor>1 更密集，<1 更稀疏）。
 * 保持相对顺序与首事件时刻不变：t' = t0 + (t - t0) / factor。
 */
export function rescaleSource(
  events: NormEvent[],
  sourceId: string,
  factor: number,
): NormEvent[] {
  const mine = events
    .filter((e) => e.sourceId === sourceId)
    .sort((a, b) => a.arrivalTime - b.arrivalTime || a.inputIndex - b.inputIndex);
  if (mine.length === 0 || factor === 1) return events;
  const t0 = mine[0].arrivalTime;
  const scaled = new Map<string, number>();
  for (const e of mine) {
    scaled.set(e.id, t0 + (e.arrivalTime - t0) / factor);
  }
  const next = events.map((e) =>
    scaled.has(e.id) ? { ...e, arrivalTime: scaled.get(e.id)! } : e,
  );
  next.sort((a, b) =>
    a.arrivalTime === b.arrivalTime
      ? a.inputIndex - b.inputIndex
      : a.arrivalTime - b.arrivalTime,
  );
  return next;
}
