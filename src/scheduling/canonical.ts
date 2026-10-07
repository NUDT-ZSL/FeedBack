/**
 * 规范化序列：把推演结果压成确定性的可比较结构，
 * 用于跨入口一致性断言与增量/全量等价断言。
 */
import type { ScheduleResult } from './types.ts';

export interface CanonicalSchedule {
  ok: boolean;
  findings: string[];
  entries: string[];
  adjudications: string[];
  loomSummaries: string[];
  orderSummaries: string[];
}

export function canonicalize(result: ScheduleResult): CanonicalSchedule {
  const entries = result.entries
    .map(
      (e) =>
        `${e.stepId}@${e.loomId}[${e.startMinute}-${e.endMinute}]w${e.workMinutes}` +
        `|delay=${e.delay.delayMinutes}:${e.delay.reason}`,
    )
    .sort();
  const adjudications = result.adjudications
    .map((a) => {
      const cands = a.candidates
        .map((c) => `${c.loomId}/p${c.priority}/${c.outcome}`)
        .sort()
        .join(',');
      return `${a.stepId}->${a.selectedLoomId}(${cands})`;
    })
    .sort();
  return {
    ok: result.ok,
    findings: result.findings
      .map((f) => `${f.severity}:${f.code}:${f.refs.join('+')}`)
      .sort(),
    entries,
    adjudications,
    loomSummaries: result.loomSummaries
      .map((s) => `${s.loomId}:busy=${s.busyMinutes},idle=${s.idleMinutes},util=${s.utilization}`)
      .sort(),
    orderSummaries: result.orderSummaries
      .map((s) => `${s.orderId}:work=${s.workMinutes},end=${s.makespanEnd},late=${s.lateMinutes}`)
      .sort(),
  };
}

export function canonicalEquals(a: ScheduleResult, b: ScheduleResult): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

/** 返回首个不一致的维度与内容，用于失败定位 */
export function canonicalDiff(a: ScheduleResult, b: ScheduleResult): string {
  const ca = canonicalize(a);
  const cb = canonicalize(b);
  const parts: string[] = [];
  if (ca.ok !== cb.ok) parts.push(`ok: ${ca.ok} != ${cb.ok}`);
  for (const key of ['findings', 'entries', 'adjudications', 'loomSummaries', 'orderSummaries'] as const) {
    const sa = new Set(ca[key]);
    const sb = new Set(cb[key]);
    const onlyA = [...sa].filter((x) => !sb.has(x));
    const onlyB = [...sb].filter((x) => !sa.has(x));
    if (onlyA.length > 0 || onlyB.length > 0) {
      parts.push(`维度[${key}] 不一致：\n    仅左: ${onlyA.join(' | ') || '(无)'}\n    仅右: ${onlyB.join(' | ') || '(无)'}`);
    }
  }
  return parts.join('\n  ');
}
