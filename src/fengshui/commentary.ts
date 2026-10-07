import { angleTo24Mountain } from "./heading";
import { judgeDragonVein, type DragonVeinTrend } from "./dragonVein";
import type { Mountain, Position3D } from "./types";

const WATER_COMMENTS = [
  "水口方位",
  "来水去处",
  "水局格局",
  "明堂水势",
];

const MOUNTAIN_COMMENTS = [
  "龙脉走势",
  "靠山方位",
  "案山朝向",
  "玄武垂头",
];

const AUSPICIOUS_COMMENTS = [
  "宜放置招财符",
  "宜设文昌塔",
  "宜挂八卦镜",
  "宜植松柏",
  "宜开南门",
  "宜立泰山石",
  "宜修蓄水池",
  "宜安财神位",
];

const COMPASS_DIRECTIONS = [
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
];

export interface CommentarySelection {
  seed: number;
  unitRandom: number;
  templateIndex: number;
  directionIndex: number;
  auspiciousIndex: number;
}

export function computeCommentarySeed(
  position: Position3D,
  height: number
): number {
  return Math.abs(
    Math.sin(position.x * 12.9898 + position.z * 78.233 + height * 43.758) *
      43758.5453
  );
}

export function selectCommentary(
  position: Position3D,
  height: number
): CommentarySelection {
  const seed = computeCommentarySeed(position, height);
  const unitRandom = seed - Math.floor(seed);
  return {
    seed,
    unitRandom,
    templateIndex: Math.floor(unitRandom * WATER_COMMENTS.length),
    directionIndex: Math.floor(
      ((unitRandom * 1000) % 1) * COMPASS_DIRECTIONS.length
    ),
    auspiciousIndex: Math.floor(
      ((unitRandom * 100000) % 1) * AUSPICIOUS_COMMENTS.length
    ),
  };
}

export function renderCommentary(
  mountain: Mountain,
  trend: DragonVeinTrend,
  selection: CommentarySelection
): string {
  const topic =
    trend === "mountain"
      ? MOUNTAIN_COMMENTS[selection.templateIndex]
      : WATER_COMMENTS[selection.templateIndex];
  return `此地${topic}：${mountain}·${
    COMPASS_DIRECTIONS[selection.directionIndex]
  }，${AUSPICIOUS_COMMENTS[selection.auspiciousIndex]}`;
}

export function generateFengshuiCommentary(
  position: Position3D,
  height: number,
  dragonAngle: number
): string {
  const { mountain } = angleTo24Mountain(dragonAngle);
  const selection = selectCommentary(position, height);
  return renderCommentary(mountain, judgeDragonVein(height), selection);
}

export {
  WATER_COMMENTS,
  MOUNTAIN_COMMENTS,
  AUSPICIOUS_COMMENTS,
  COMPASS_DIRECTIONS,
};
