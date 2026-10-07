import type { FengshuiInput } from "../src/fengshui";

export interface BatchCase extends FengshuiInput {
  label: string;
}

const EPSILON = 1e-6;

const basePositions: Array<{ label: string; position: FengshuiInput["position"] }> = [
  { label: "origin", position: { x: 0, y: 0, z: 0 } },
  { label: "negative", position: { x: -10.5, y: -3, z: -7.25 } },
  { label: "large-positive", position: { x: 1_000_000, y: 12, z: 999_999.75 } },
  { label: "large-negative", position: { x: -1_000_000, y: -12, z: -999_999.75 } },
  { label: "fractional", position: { x: 3.14159265358979, y: 1.4142, z: 2.718281828 } },
];

const angles: Array<{ label: string; value: number }> = [
  { label: "zero", value: 0 },
  { label: "full-circle", value: 360 },
  { label: "two-turns", value: 720 },
  { label: "negative-circle", value: -360 },
  { label: "just-before-zero", value: -EPSILON },
  { label: "just-before-full", value: 360 - EPSILON },
  ...Array.from({ length: 24 }, (_, i) => i * 15).flatMap((boundary) => [
    { label: `boundary-${boundary}-minus`, value: boundary - EPSILON },
    { label: `boundary-${boundary}`, value: boundary },
    { label: `boundary-${boundary}-plus`, value: boundary + EPSILON },
  ]),
  { label: "extreme-large-angle", value: 1e9 + 7.5 },
  { label: "extreme-negative-angle", value: -1e9 - 7.5 },
];

const heights: Array<{ label: string; value: number }> = [
  { label: "threshold-exact", value: 100 },
  { label: "threshold-minus", value: 100 - EPSILON },
  { label: "threshold-plus", value: 100 + EPSILON },
  { label: "zero", value: 0 },
  { label: "negative", value: -2 },
  { label: "extreme-large", value: 1e6 },
  { label: "extreme-negative", value: -1e6 },
];

export const DEFAULT_CASES: BatchCase[] = [
  ...angles.map((a) => ({
    label: `heading/${a.label}`,
    position: basePositions[0].position,
    height: 0,
    dragonAngle: a.value,
  })),
  ...heights.map((h) => ({
    label: `height/${h.label}`,
    position: basePositions[3].position,
    height: h.value,
    dragonAngle: 112.5,
  })),
  ...basePositions.map((p, i) => ({
    label: `position/${p.label}`,
    position: p.position,
    height: i % 2 === 0 ? 50 : 150,
    dragonAngle: 202.5 + (i - 2) * EPSILON,
  })),
  {
    label: "all-boundary-cross",
    position: { x: 7.777777, y: 0, z: -7.777777 },
    height: 100,
    dragonAngle: 7.5,
  },
];
