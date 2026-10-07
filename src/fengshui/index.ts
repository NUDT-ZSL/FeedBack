export type {
  Position3D,
  Direction,
  Mountain,
} from "./types";
export {
  MOUNTAIN_COUNT,
  MOUNTAIN_SPAN_DEGREES,
  MOUNTAIN_HALF_SPAN_DEGREES,
  normalizeAngle,
  angleToMountainIndex,
  angleTo24Mountain,
  type MountainResult,
} from "./heading";
export {
  DRAGON_VEIN_HEIGHT_THRESHOLD,
  judgeDragonVein,
  type DragonVeinTrend,
} from "./dragonVein";
export {
  WATER_COMMENTS,
  MOUNTAIN_COMMENTS,
  AUSPICIOUS_COMMENTS,
  COMPASS_DIRECTIONS,
  computeCommentarySeed,
  selectCommentary,
  renderCommentary,
  generateFengshuiCommentary,
  type CommentarySelection,
} from "./commentary";
export {
  analyzeFengshui,
  type FengshuiInput,
  type FengshuiAnalysis,
  type HeadingDeduction,
  type DragonVeinDeduction,
  type CommentaryDeduction,
} from "./analyze";
