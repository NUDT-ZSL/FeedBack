import { civilToJd, jdToCivil } from './time';
import { EclipseResult } from './engine';

export interface HistoricalRecord {
  id: string;
  source: string;
  year: number;
  month: number;
  day: number;
  kind: 'solar' | 'lunar';
  typeLabel?: string;
  shichen: string;
  magnitude?: number;
  note?: string;
}

export type ComparisonVerdict = 'match' | 'deviation' | 'no_record';

export interface ComparisonResult {
  verdict: ComparisonVerdict;
  verdictLabel: string;
  recordId: string | null;
  source: string | null;
  dateOffsetDays: number | null;
  timeDeviationHours: number | null;
  timeDeviationPercent: number | null;
  magnitudeDeviation: number | null;
  magnitudeDeviationPercent: number | null;
}

export const SHICHEN: Array<{ name: string; centerHour: number }> = [
  { name: '子', centerHour: 0 },
  { name: '丑', centerHour: 2 },
  { name: '寅', centerHour: 4 },
  { name: '卯', centerHour: 6 },
  { name: '辰', centerHour: 8 },
  { name: '巳', centerHour: 10 },
  { name: '午', centerHour: 12 },
  { name: '未', centerHour: 14 },
  { name: '申', centerHour: 16 },
  { name: '酉', centerHour: 18 },
  { name: '戌', centerHour: 20 },
  { name: '亥', centerHour: 22 },
];

const DAY_TOLERANCE = 3;
const HOUR_TOLERANCE = 2;
const MAGNITUDE_TOLERANCE = 0.1;

export function shichenCenterHour(name: string): number | null {
  return SHICHEN.find((s) => s.name === name)?.centerHour ?? null;
}

function cyclicHourDiff(a: number, b: number): number {
  let diff = (a - b) % 24;
  if (diff > 12) diff -= 24;
  if (diff < -12) diff += 24;
  return Math.abs(diff);
}

export function compareWithRecord(
  result: EclipseResult,
  record: HistoricalRecord,
): ComparisonResult {
  const recordJd = civilToJd({
    year: record.year,
    month: record.month,
    day: record.day,
    hour: 12,
  });
  const dateOffsetDays = result.syzygyJd - recordJd;
  if (result.kind !== record.kind || Math.abs(dateOffsetDays) > DAY_TOLERANCE) {
    return {
      verdict: 'no_record',
      verdictLabel: '无对应记录',
      recordId: null,
      source: null,
      dateOffsetDays: null,
      timeDeviationHours: null,
      timeDeviationPercent: null,
      magnitudeDeviation: null,
      magnitudeDeviationPercent: null,
    };
  }

  const maxPhase = result.phases.find((p) => p.key === 'max') ?? result.phases[0];
  const localHour = maxPhase?.local?.hour ?? jdToCivil(result.syzygyJd).hour;
  const recordHour = shichenCenterHour(record.shichen);
  const timeDeviationHours =
    recordHour === null ? null : cyclicHourDiff(localHour, recordHour);
  const magnitudeDeviation =
    record.magnitude === undefined ? null : Math.abs(result.magnitude - record.magnitude);

  const timeOk = timeDeviationHours === null || timeDeviationHours <= HOUR_TOLERANCE;
  const magnitudeOk =
    magnitudeDeviation === null || magnitudeDeviation <= MAGNITUDE_TOLERANCE;
  const verdict = timeOk && magnitudeOk ? 'match' : 'deviation';

  return {
    verdict,
    verdictLabel: verdict === 'match' ? '吻合' : '存在偏差',
    recordId: record.id,
    source: record.source,
    dateOffsetDays,
    timeDeviationHours,
    timeDeviationPercent: timeDeviationHours === null ? null : (timeDeviationHours / 24) * 100,
    magnitudeDeviation,
    magnitudeDeviationPercent:
      magnitudeDeviation === null || record.magnitude === undefined
        ? null
        : (magnitudeDeviation / record.magnitude) * 100,
  };
}

export function compareAgainstRecords(
  result: EclipseResult,
  records: HistoricalRecord[],
): ComparisonResult {
  const sameKind = records.filter((r) => r.kind === result.kind);
  let best: { record: HistoricalRecord; result: ComparisonResult } | null = null;
  for (const record of sameKind) {
    const comp = compareWithRecord(result, record);
    if (comp.verdict === 'no_record') continue;
    if (
      best === null ||
      (comp.verdict === 'match' && best.result.verdict !== 'match') ||
      Math.abs(comp.dateOffsetDays ?? Infinity) <
        Math.abs(best.result.dateOffsetDays ?? Infinity)
    ) {
      best = { record, result: comp };
    }
  }
  if (best === null) {
    return {
      verdict: 'no_record',
      verdictLabel: '无对应记录',
      recordId: null,
      source: null,
      dateOffsetDays: null,
      timeDeviationHours: null,
      timeDeviationPercent: null,
      magnitudeDeviation: null,
      magnitudeDeviationPercent: null,
    };
  }
  return best.result;
}
