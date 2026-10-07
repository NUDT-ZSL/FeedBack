import { angleTo24Mountain, normalizeAngle } from "./compass.ts";
import { judgeDragonVein } from "./dragonVein.ts";
import type { DragonVeinJudgment } from "./dragonVein.ts";
import type { Direction, Mountain, Position3D } from "./types.ts";

export const AUSPICIOUS_COMMENTS = [
  "宜放置招财符",
  "宜设文昌塔",
  "宜挂八卦镜",
  "宜植松柏",
  "宜开南门",
  "宜立泰山石",
  "宜修蓄水池",
  "宜安财神位",
] as const;

export const BEARING_LABELS = [
  "北",
  "北偏东15度",
  "北偏东30度",
  "东北偏北15度",
  "东北",
  "东北偏东15度",
  "东偏北30度",
  "东偏北15度",
  "东",
  "东偏南15度",
  "东偏南30度",
  "东南偏东15度",
  "东南",
  "东南偏南15度",
  "南偏东30度",
  "南偏东15度",
  "南",
  "南偏西15度",
  "南偏西30度",
  "西南偏南15度",
  "西南",
  "西南偏西15度",
  "西偏南30度",
  "西偏南15度",
  "西",
  "西偏北15度",
  "西偏北30度",
  "西北偏西15度",
  "西北",
  "西北偏北15度",
  "北偏西30度",
  "北偏西15度",
] as const;

export interface PositionSeed {
  raw: number;
  fraction: number;
}

export function computePositionSeed(
  position: Position3D,
  height: number
): PositionSeed {
  const raw = Math.abs(
    Math.sin(position.x * 12.9898 + position.z * 78.233 + height * 43.758) *
      43758.5453
  );
  return { raw, fraction: raw - Math.floor(raw) };
}

export interface CommentaryPick {
  themeIndex: number;
  bearingIndex: number;
  auspiciousIndex: number;
}

export function pickCommentaryIndices(
  seed: PositionSeed,
  themeCount: number
): CommentaryPick {
  const r = seed.fraction;
  return {
    themeIndex: Math.floor(r * themeCount),
    bearingIndex: Math.floor(((r * 1000) % 1) * BEARING_LABELS.length),
    auspiciousIndex: Math.floor(((r * 100000) % 1) * AUSPICIOUS_COMMENTS.length),
  };
}

export interface FengshuiAnalysis {
  input: {
    position: Position3D;
    height: number;
    dragonAngle: number;
  };
  compass: {
    normalizedAngle: number;
    mountain: Mountain;
    direction: Direction;
  };
  dragonVein: DragonVeinJudgment;
  seed: PositionSeed;
  pick: CommentaryPick;
  parts: {
    theme: string;
    bearing: string;
    auspicious: string;
  };
  commentary: string;
}

export function analyzeFengshui(
  position: Position3D,
  height: number,
  dragonAngle: number
): FengshuiAnalysis {
  const { mountain, direction } = angleTo24Mountain(dragonAngle);
  const dragonVein = judgeDragonVein(height);
  const seed = computePositionSeed(position, height);
  const pick = pickCommentaryIndices(seed, dragonVein.themes.length);
  const theme = dragonVein.themes[pick.themeIndex];
  const bearing = BEARING_LABELS[pick.bearingIndex];
  const auspicious = AUSPICIOUS_COMMENTS[pick.auspiciousIndex];
  return {
    input: { position, height, dragonAngle },
    compass: {
      normalizedAngle: normalizeAngle(dragonAngle),
      mountain,
      direction,
    },
    dragonVein,
    seed,
    pick,
    parts: { theme, bearing, auspicious },
    commentary: `此地${theme}：${mountain}·${bearing}，${auspicious}`,
  };
}

export function generateFengshuiCommentary(
  position: Position3D,
  height: number,
  dragonAngle: number
): string {
  return analyzeFengshui(position, height, dragonAngle).commentary;
}
