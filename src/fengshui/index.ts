export type {
  Direction,
  Mountain,
  MountainResult,
  Position3D,
} from "./types.ts";
export {
  MOUNTAIN_COUNT,
  MOUNTAIN_SPAN_DEGREES,
  MOUNTAIN_HALF_SPAN_DEGREES,
  normalizeAngle,
  angleToMountainIndex,
  angleTo24Mountain,
} from "./compass.ts";
export {
  DRAGON_VEIN_HEIGHT_THRESHOLD,
  DRAGON_THEMES,
  WATER_THEMES,
  judgeDragonVein,
} from "./dragonVein.ts";
export type {
  TerrainKind,
  DragonVeinJudgment,
} from "./dragonVein.ts";
export {
  AUSPICIOUS_COMMENTS,
  BEARING_LABELS,
  computePositionSeed,
  pickCommentaryIndices,
  analyzeFengshui,
  generateFengshuiCommentary,
} from "./commentary.ts";
export type {
  PositionSeed,
  CommentaryPick,
  FengshuiAnalysis,
} from "./commentary.ts";
export {
  runBatchFengshui,
  DEFAULT_BATCH_CASES,
} from "./batch.ts";
export type { FengshuiBatchCase, FengshuiBatchResult } from "./batch.ts";
