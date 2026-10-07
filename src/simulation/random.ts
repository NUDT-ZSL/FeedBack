/**
 * 确定性随机源：mulberry32。
 * 同一种子产生同一序列，用于让划痕生成 / 修复判定可被外部固定种子复现。
 */
export type RandomSource = () => number;

export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从主种子派生独立子流种子，避免不同用途的随机消费互相干扰。 */
export function deriveSeed(seed: number, stream: number): number {
  let h = (seed >>> 0) ^ Math.imul((stream >>> 0) + 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
