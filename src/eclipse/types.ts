export type EclipseKind = "solar" | "lunar";

export type EclipseType =
  | "none"
  | "solar-total"
  | "solar-annular"
  | "solar-partial"
  | "lunar-total"
  | "lunar-partial"
  | "lunar-penumbral";

export interface Observer {
  latitudeDeg: number;
  longitudeDeg: number;
  utcOffsetHours: number;
}

export interface EclipseInput {
  date: Date;
  kind: EclipseKind;
  observer?: Observer;
}

export interface PhaseTimes {
  firstContact: Date;
  maximum: Date;
  lastContact: Date;
}

export interface VisibilityResult {
  visible: boolean;
  maxAltitudeDeg: number;
  altitudeAtMaximumDeg: number;
  visibleFrom: Date | null;
  visibleUntil: Date | null;
  reason: "above-horizon" | "below-horizon" | "no-eclipse";
}

export interface EclipsePrediction {
  kind: EclipseKind;
  type: EclipseType;
  magnitude: number;
  jdAtMaximum: number;
  maximum: Date;
  phases: PhaseTimes | null;
  minimumSeparationDeg: number;
  visibility: VisibilityResult | null;
}

export interface HistoricalRecord {
  id: string;
  source: string;
  calendarYear: number;
  kind: EclipseKind;
  type: EclipseType;
  date: Date;
  magnitude: number;
}

export type MatchConclusion =
  | "none-event"
  | "record-match"
  | "magnitude-deviation"
  | "type-mismatch"
  | "no-record";

export interface RecordComparison {
  recordId: string | null;
  source: string | null;
  magnitudeDelta: number | null;
  timeDeltaMinutes: number | null;
  typeMatches: boolean;
  conclusion: MatchConclusion;
}
