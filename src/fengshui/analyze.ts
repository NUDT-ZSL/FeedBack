import {
  angleTo24Mountain,
  angleToMountainIndex,
  normalizeAngle,
} from "./heading";
import {
  DRAGON_VEIN_HEIGHT_THRESHOLD,
  judgeDragonVein,
  type DragonVeinTrend,
} from "./dragonVein";
import {
  renderCommentary,
  selectCommentary,
  type CommentarySelection,
} from "./commentary";
import type { Direction, Mountain, Position3D } from "./types";

export interface FengshuiInput {
  position: Position3D;
  height: number;
  dragonAngle: number;
}

export interface HeadingDeduction {
  rawAngle: number;
  normalizedAngle: number;
  mountainIndex: number;
  mountain: Mountain;
  direction: Direction;
}

export interface DragonVeinDeduction {
  height: number;
  threshold: number;
  trend: DragonVeinTrend;
}

export interface CommentaryDeduction extends CommentarySelection {
  text: string;
}

export interface FengshuiAnalysis {
  input: FengshuiInput;
  heading: HeadingDeduction;
  dragonVein: DragonVeinDeduction;
  commentary: CommentaryDeduction;
}

export function analyzeFengshui(input: FengshuiInput): FengshuiAnalysis {
  const { position, height, dragonAngle } = input;

  const mountainResult = angleTo24Mountain(dragonAngle);
  const trend = judgeDragonVein(height);
  const selection = selectCommentary(position, height);

  return {
    input: {
      position: { ...position },
      height,
      dragonAngle,
    },
    heading: {
      rawAngle: dragonAngle,
      normalizedAngle: normalizeAngle(dragonAngle),
      mountainIndex: angleToMountainIndex(dragonAngle),
      mountain: mountainResult.mountain,
      direction: mountainResult.direction,
    },
    dragonVein: {
      height,
      threshold: DRAGON_VEIN_HEIGHT_THRESHOLD,
      trend,
    },
    commentary: {
      ...selection,
      text: renderCommentary(mountainResult.mountain, trend, selection),
    },
  };
}
