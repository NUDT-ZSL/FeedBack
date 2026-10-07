import { SimOutput } from "./simulate";

export interface CheckReport {
  ok: boolean;
  failures: string[];
  invariants: { name: string; ok: boolean; detail?: string }[];
}

/** 稳定序列化：忽略推演过程中的 snapshots，只核对最终结论。 */
function digest(output: SimOutput): string {
  const strip = (o: SimOutput) => ({
    events: o.events.map((e) => ({
      eventId: e.eventId,
      sourceId: e.sourceId,
      arrivalTime: e.arrivalTime,
      status: e.status,
      decidedBy: e.decidedBy,
      consumedAt: e.consumedAt,
    })),
    switches: o.switches,
    series: o.series,
    stats: o.stats,
  });
  return JSON.stringify(strip(output), (_, v) =>
    typeof v === "number" ? roundTiny(v) : v,
  );
}

function roundTiny(n: number): number {
  // 消除浮点尾差（1e-9 精度），真实时序分歧应远大于此
  return Math.round(n * 1e9) / 1e9;
}

/**
 * 单次推演结果的不变量检查：
 * 1. 每个事件有且仅有一条最终结论；
 * 2. 事件数守恒：kept+queued+dropped*+downsampled+held = 输入事件数；
 * 3. 积压恒非负，且等于 perSource 之和；
 * 4. 切换记录时间单调、区间首尾相接，触发依据与当时积压一致；
 * 5. kept 事件必有 consumedAt，其余状态无 consumedAt；
 * 6. 每个决策依据（base 或 sw#n）都能对应到存在的切换记录。
 */
export function checkInvariants(output: SimOutput): CheckReport {
  const failures: string[] = [];
  const inv: CheckReport["invariants"] = [];
  const add = (name: string, ok: boolean, detail?: string) => {
    inv.push({ name, ok, detail });
    if (!ok) failures.push(`${name}: ${detail ?? ""}`);
  };

  const inputIds = new Set(output.normEvents.map((e) => e.id));
  const decisionIds = new Set<string>();
  let dup = false;
  for (const e of output.events) {
    if (decisionIds.has(e.eventId)) dup = true;
    decisionIds.add(e.eventId);
  }
  add("结论唯一", output.events.length === inputIds.size && !dup,
    `输入 ${inputIds.size} 条 / 结论 ${output.events.length} 条 / 重复 ${dup}`);

  const s = output.stats;
  const accounted =
    s.kept + s.queued + s.dropped + s.downsampledOut + s.held;
  add("事件数守恒", accounted === s.totalEvents,
    `守恒合计 ${accounted} vs 总计 ${s.totalEvents}`);

  let nonNeg = true;
  let perSum = true;
  for (const p of output.series) {
    if (p.total < 0) nonNeg = false;
    const sum = Object.values(p.perSource).reduce((a, b) => a + b, 0);
    if (sum !== p.total) perSum = false;
  }
  add("积压非负", nonNeg);
  add("按来源合计一致", perSum);

  let mono = true;
  let chain = true;
  for (let i = 0; i < output.switches.length; i++) {
    const sw = output.switches[i];
    if (i > 0 && sw.time < output.switches[i - 1].time) mono = false;
    if (i + 1 < output.switches.length && sw.range.end !== output.switches[i + 1].time) {
      chain = false;
    }
    if (sw.direction === "escalate" && sw.trigger.backlog < sw.trigger.threshold) {
      failures.push(`切换依据不自洽 ${sw.id}: 积压 ${sw.trigger.backlog} < 阈值 ${sw.trigger.threshold}`);
    }
  }
  add("切换时刻单调", mono);
  add("切换区间相接", chain);

  let consumedConsistent = true;
  const switchIds = new Set(output.switches.map((sw) => sw.id));
  let basisExists = true;
  for (const e of output.events) {
    if (e.status === "kept" && e.consumedAt === undefined) consumedConsistent = false;
    if (e.status !== "kept" && e.consumedAt !== undefined) consumedConsistent = false;
    if (e.decidedBy !== "base" && !switchIds.has(e.decidedBy)) basisExists = false;
  }
  add("消费时刻一致", consumedConsistent);
  add("处置依据可追溯", basisExists);

  return { ok: failures.length === 0, failures, invariants: inv };
}

/**
 * 增量重推结果必须与整体重推逐字段一致。
 */
export function verifyEquivalence(incremental: SimOutput, full: SimOutput): CheckReport {
  const report = checkInvariants(incremental);
  const a = digest(incremental);
  const b = digest(full);
  if (a !== b) {
    report.ok = false;
    report.failures.push("增量重推与整体重推结果不一致");
    // 定位首个分歧点，便于排查
    const ea = incremental.events;
    const eb = full.events;
    const byIdB = new Map(eb.map((e) => [e.eventId, e]));
    for (const x of ea) {
      const y = byIdB.get(x.eventId);
      if (!y || x.status !== y.status || x.decidedBy !== y.decidedBy ||
        x.consumedAt !== y.consumedAt) {
        report.failures.push(
          `首个分歧事件 ${x.eventId}: 增量=${x.status}/${x.decidedBy}/${x.consumedAt ?? ""} ` +
          `全量=${y?.status ?? "缺失"}/${y?.decidedBy ?? ""}/${y?.consumedAt ?? ""}`,
        );
        break;
      }
    }
  }
  return report;
}
