import type { Direction, Mountain } from "./types";

export interface MountainResult {
  mountain: Mountain;
  direction: Direction;
}

export const MOUNTAIN_COUNT = 24;
export const MOUNTAIN_SPAN_DEGREES = 15;
export const MOUNTAIN_HALF_SPAN_DEGREES = 7.5;

const MOUNTAINS: Mountain[] = [
  "壬",
  "子",
  "癸",
  "丑",
  "艮",
  "寅",
  "甲",
  "卯",
  "乙",
  "辰",
  "巽",
  "巳",
  "丙",
  "午",
  "丁",
  "未",
  "坤",
  "申",
  "庚",
  "酉",
  "辛",
  "戌",
  "乾",
  "亥",
];

const DIRECTIONS: Direction[] = [
  "坎",
  "坎",
  "坎",
  "艮",
  "艮",
  "艮",
  "震",
  "震",
  "震",
  "巽",
  "巽",
  "巽",
  "离",
  "离",
  "离",
  "坤",
  "坤",
  "坤",
  "兑",
  "兑",
  "兑",
  "乾",
  "乾",
  "乾",
];

export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

export function angleToMountainIndex(angle: number): number {
  const normalized = normalizeAngle(angle);
  return (
    Math.floor((normalized + MOUNTAIN_HALF_SPAN_DEGREES) / MOUNTAIN_SPAN_DEGREES) %
    MOUNTAIN_COUNT
  );
}

export function angleTo24Mountain(angle: number): MountainResult {
  const index = angleToMountainIndex(angle);
  return {
    mountain: MOUNTAINS[index],
    direction: DIRECTIONS[index],
  };
}
