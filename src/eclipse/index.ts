export * from "./types.ts";
export * from "./julian.ts";
export * from "./ephemeris.ts";
export {
  classifySolarEclipse,
  classifyLunarEclipse,
  solarMagnitude,
  lunarUmbralMagnitude,
  solvePhaseTimes,
  predictEclipse,
  computeVisibility,
  solarAltitudeDeg,
  lunarAltitudeDeg,
  HYBRID_TOLERANCE,
  MAGNITUDE_EPSILON,
} from "./eclipse.ts";
export {
  loadRecords,
  findClosestRecord,
  compareWithRecord,
  DEFAULT_THRESHOLDS,
} from "./records.ts";
export type { ComparisonThresholds } from "./records.ts";
export { SHOUSHI_RECORDS } from "./data/shoushi-records.ts";
