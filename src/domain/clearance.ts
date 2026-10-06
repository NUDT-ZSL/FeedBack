import type { CargoEntry, ClearanceConclusion, ClearanceGrade, DutyLine, Origin, TariffSchedule } from './types';
import { effectiveRate, round2 } from './tariff';

/** 税银逾此数（贯）需监官复核 */
export const REVIEW_THRESHOLD = 800;

export function activeEntries(manifest: CargoEntry[]): CargoEntry[] {
  return manifest.filter((e) => e.status === 'active');
}

/**
 * 从头重算整船通关结论：以当前全部有效货单条目 + 当前关税口径整体推导，
 * 不做局部增量修补。裁定落地、货单外部修正、口径调整均走此同一入口。
 */
export function buildConclusion(
  origin: Origin,
  manifest: CargoEntry[],
  schedule: TariffSchedule,
  computedAt: number,
): ClearanceConclusion {
  const lines: DutyLine[] = activeEntries(manifest).map((e) => {
    const rate = effectiveRate(schedule, origin, e.category);
    return {
      entryId: e.id,
      name: e.name,
      category: e.category,
      source: e.source,
      quantity: e.quantity,
      unitValue: e.unitValue,
      rate,
      duty: round2(e.quantity * e.unitValue * rate),
    };
  });
  const totalDuty = round2(lines.reduce((sum, l) => sum + l.duty, 0));
  const hasDispute = manifest.some((e) => e.status === 'disputed');
  const grade: ClearanceGrade = hasDispute ? 'detain' : totalDuty >= REVIEW_THRESHOLD ? 'review' : 'pass';
  const reason = hasDispute
    ? '货单与抽检记录冲突未裁，暂扣候裁'
    : totalDuty >= REVIEW_THRESHOLD
      ? `税银逾 ${REVIEW_THRESHOLD} 贯，需监官复核`
      : '验讫无异，准予通关';
  return { lines, totalDuty, grade, scheduleVersion: schedule.version, computedAt, reason };
}

/** 比对两份结论（忽略计算时刻），返回差异描述；空数组表示一致 */
export function diffConclusions(a: ClearanceConclusion, b: ClearanceConclusion): string[] {
  const diffs: string[] = [];
  if (a.grade !== b.grade) diffs.push(`通关结论不一致：${a.grade} ≠ ${b.grade}`);
  if (a.totalDuty !== b.totalDuty) diffs.push(`税银总额不一致：${a.totalDuty} ≠ ${b.totalDuty}`);
  if (a.scheduleVersion !== b.scheduleVersion)
    diffs.push(`关税口径版本不一致：v${a.scheduleVersion} ≠ v${b.scheduleVersion}`);
  const bLines = new Map(b.lines.map((l) => [l.entryId, l]));
  for (const la of a.lines) {
    const lb = bLines.get(la.entryId);
    if (!lb) {
      diffs.push(`条目「${la.name}」在重推结果中缺失`);
      continue;
    }
    if (la.duty !== lb.duty || la.rate !== lb.rate)
      diffs.push(`条目「${la.name}」税额不一致：${la.duty} ≠ ${lb.duty}`);
    if (la.quantity !== lb.quantity || la.unitValue !== lb.unitValue)
      diffs.push(`条目「${la.name}」数量/估值不一致`);
  }
  for (const lb of b.lines) {
    if (!a.lines.some((l) => l.entryId === lb.entryId)) diffs.push(`重推结果多出条目「${lb.name}」`);
  }
  return diffs;
}
