import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareWithRecord,
  predictEclipse,
  roundTo,
} from "../src/eclipse/index.ts";
import type {
  EclipseKind,
  EclipsePrediction,
  Observer,
  RecordComparison,
} from "../src/eclipse/index.ts";

export interface GoldenCaseInput {
  dateISO: string;
  kind: EclipseKind;
  observer?: Observer;
}

export interface GoldenCase {
  name: string;
  input: GoldenCaseInput;
}

export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: "solar-total-1311",
    input: { dateISO: "1311-07-24T18:00:00.000Z", kind: "solar" },
  },
  {
    name: "solar-partial-deep-1282",
    input: { dateISO: "1282-08-12T03:37:00.000Z", kind: "solar" },
  },
  {
    name: "solar-grazing-1319",
    input: { dateISO: "1319-03-01T00:40:00.000Z", kind: "solar" },
  },
  {
    name: "solar-grazing-1326",
    input: { dateISO: "1326-10-04T22:45:00.000Z", kind: "solar" },
  },
  {
    name: "solar-none-1335",
    input: { dateISO: "1335-07-15T00:00:00.000Z", kind: "solar" },
  },
  {
    name: "solar-visible-dadu-1311",
    input: {
      dateISO: "1311-07-24T18:00:00.000Z",
      kind: "solar",
      observer: { latitudeDeg: 39.9, longitudeDeg: 116.4, utcOffsetHours: 8 },
    },
  },
  {
    name: "solar-polar-summer-1311",
    input: {
      dateISO: "1311-07-24T18:00:00.000Z",
      kind: "solar",
      observer: { latitudeDeg: 85, longitudeDeg: 0, utcOffsetHours: 0 },
    },
  },
  {
    name: "solar-polar-winter-1319",
    input: {
      dateISO: "1319-03-01T00:40:00.000Z",
      kind: "solar",
      observer: { latitudeDeg: -85, longitudeDeg: 0, utcOffsetHours: 0 },
    },
  },
  {
    name: "lunar-total-1284",
    input: { dateISO: "1284-01-11T12:34:00.000Z", kind: "lunar" },
  },
  {
    name: "lunar-partial-deep-1299",
    input: { dateISO: "1299-09-18T10:52:00.000Z", kind: "lunar" },
  },
  {
    name: "lunar-grazing-1286",
    input: { dateISO: "1286-11-09T22:30:00.000Z", kind: "lunar" },
  },
  {
    name: "lunar-none-1335",
    input: { dateISO: "1335-07-15T00:00:00.000Z", kind: "lunar" },
  },
  {
    name: "lunar-visible-dadu-1284",
    input: {
      dateISO: "1284-01-11T12:34:00.000Z",
      kind: "lunar",
      observer: { latitudeDeg: 39.9, longitudeDeg: 116.4, utcOffsetHours: 8 },
    },
  },
  {
    name: "lunar-polar-1284",
    input: {
      dateISO: "1284-01-11T12:34:00.000Z",
      kind: "lunar",
      observer: { latitudeDeg: 85, longitudeDeg: 135, utcOffsetHours: 9 },
    },
  },
  {
    name: "lunar-deviation-1285",
    input: { dateISO: "1285-06-25T14:35:00.000Z", kind: "lunar" },
  },
  {
    name: "solar-no-record-1365",
    input: { dateISO: "1365-03-01T12:00:00.000Z", kind: "solar" },
  },
];

export interface GoldenPredictionSnapshot {
  type: string;
  magnitude: number;
  maximumISO: string;
  jdAtMaximum: number;
  minimumSeparationDeg: number;
  phases: {
    firstContactISO: string;
    maximumISO: string;
    lastContactISO: string;
  } | null;
  visibility: {
    visible: boolean;
    maxAltitudeDeg: number;
    altitudeAtMaximumDeg: number;
    reason: string;
  } | null;
}

export interface GoldenComparisonSnapshot {
  recordId: string | null;
  magnitudeDelta: number | null;
  timeDeltaMinutes: number | null;
  typeMatches: boolean;
  conclusion: string;
}

export interface GoldenExpectation {
  prediction: GoldenPredictionSnapshot;
  comparison: GoldenComparisonSnapshot;
}

export function snapshotPrediction(
  prediction: EclipsePrediction,
): GoldenPredictionSnapshot {
  return {
    type: prediction.type,
    magnitude: roundTo(prediction.magnitude, 6),
    maximumISO: prediction.maximum.toISOString(),
    jdAtMaximum: roundTo(prediction.jdAtMaximum, 8),
    minimumSeparationDeg: roundTo(prediction.minimumSeparationDeg, 6),
    phases: prediction.phases
      ? {
          firstContactISO: prediction.phases.firstContact.toISOString(),
          maximumISO: prediction.phases.maximum.toISOString(),
          lastContactISO: prediction.phases.lastContact.toISOString(),
        }
      : null,
    visibility: prediction.visibility
      ? {
          visible: prediction.visibility.visible,
          maxAltitudeDeg: roundTo(prediction.visibility.maxAltitudeDeg, 4),
          altitudeAtMaximumDeg: roundTo(
            prediction.visibility.altitudeAtMaximumDeg,
            4,
          ),
          reason: prediction.visibility.reason,
        }
      : null,
  };
}

export function snapshotComparison(
  comparison: RecordComparison,
): GoldenComparisonSnapshot {
  return {
    recordId: comparison.recordId,
    magnitudeDelta:
      comparison.magnitudeDelta === null
        ? null
        : roundTo(comparison.magnitudeDelta, 6),
    timeDeltaMinutes:
      comparison.timeDeltaMinutes === null
        ? null
        : roundTo(comparison.timeDeltaMinutes, 3),
    typeMatches: comparison.typeMatches,
    conclusion: comparison.conclusion,
  };
}

export function buildGoldenFile(): Record<string, unknown> {
  const cases: Record<string, { input: GoldenCaseInput; expected: GoldenExpectation }> = {};
  for (const goldenCase of GOLDEN_CASES) {
    const prediction = predictEclipse({
      date: new Date(goldenCase.input.dateISO),
      kind: goldenCase.input.kind,
      observer: goldenCase.input.observer,
    });
    const comparison = compareWithRecord(prediction);
    cases[goldenCase.name] = {
      input: goldenCase.input,
      expected: {
        prediction: snapshotPrediction(prediction),
        comparison: snapshotComparison(comparison),
      },
    };
  }
  return {
    description:
      "日月食推演链路黄金基线：由 scripts/generate-golden.ts 生成，tests/golden.test.ts 校验",
    cases,
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "tests",
    "fixtures",
    "golden.json",
  );
  writeFileSync(outPath, JSON.stringify(buildGoldenFile(), null, 2) + "\n");
  console.log(`golden baseline written to ${outPath}`);
}
