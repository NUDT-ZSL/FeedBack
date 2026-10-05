import { SHOUSHI_RECORDS } from "./data/shoushi-records.ts";
import type {
  EclipsePrediction,
  HistoricalRecord,
  RecordComparison,
} from "./types.ts";

export interface ComparisonThresholds {
  magnitudeDelta: number;
  timeDeltaMinutes: number;
  associationWindowMinutes: number;
}

export const DEFAULT_THRESHOLDS: ComparisonThresholds = {
  magnitudeDelta: 0.05,
  timeDeltaMinutes: 120,
  associationWindowMinutes: 1_440,
};

export function loadRecords(): HistoricalRecord[] {
  return SHOUSHI_RECORDS.map((entry) => ({
    id: entry.id,
    source: entry.source,
    calendarYear: entry.calendarYear,
    kind: entry.kind,
    type: entry.type,
    date: new Date(entry.dateISO),
    magnitude: entry.magnitude,
  }));
}

export function findClosestRecord(
  prediction: EclipsePrediction,
  records: readonly HistoricalRecord[] = loadRecords(),
  associationWindowMinutes: number = DEFAULT_THRESHOLDS.associationWindowMinutes,
): HistoricalRecord | null {
  let closest: HistoricalRecord | null = null;
  let closestDelta = Number.POSITIVE_INFINITY;
  for (const record of records) {
    if (record.kind !== prediction.kind) continue;
    const deltaMinutes =
      Math.abs(prediction.maximum.getTime() - record.date.getTime()) / 60_000;
    if (deltaMinutes < closestDelta) {
      closestDelta = deltaMinutes;
      closest = record;
    }
  }
  if (closest !== null && closestDelta <= associationWindowMinutes) {
    return closest;
  }
  return null;
}

export function compareWithRecord(
  prediction: EclipsePrediction,
  record: HistoricalRecord | null = findClosestRecord(prediction),
  thresholds: ComparisonThresholds = DEFAULT_THRESHOLDS,
): RecordComparison {
  if (prediction.type === "none") {
    return {
      recordId: null,
      source: null,
      magnitudeDelta: null,
      timeDeltaMinutes: null,
      typeMatches: false,
      conclusion: "none-event",
    };
  }
  if (record === null) {
    return {
      recordId: null,
      source: null,
      magnitudeDelta: null,
      timeDeltaMinutes: null,
      typeMatches: false,
      conclusion: "no-record",
    };
  }

  const magnitudeDelta = prediction.magnitude - record.magnitude;
  const timeDeltaMinutes =
    (prediction.maximum.getTime() - record.date.getTime()) / 60_000;
  const typeMatches = record.type === prediction.type;
  const epsilon = 1e-9;
  const magnitudeOk =
    Math.abs(magnitudeDelta) <= thresholds.magnitudeDelta + epsilon;
  const timeOk =
    Math.abs(timeDeltaMinutes) <= thresholds.timeDeltaMinutes + epsilon;

  let conclusion: RecordComparison["conclusion"];
  if (!typeMatches) {
    conclusion = "type-mismatch";
  } else if (!magnitudeOk || !timeOk) {
    conclusion = "magnitude-deviation";
  } else {
    conclusion = "record-match";
  }

  return {
    recordId: record.id,
    source: record.source,
    magnitudeDelta,
    timeDeltaMinutes,
    typeMatches,
    conclusion,
  };
}
