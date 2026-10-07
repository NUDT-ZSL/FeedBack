/**
 * 可注入的随机来源。
 * 游戏中所有随机性都通过 RandomSource 注入：
 * 浏览器端默认使用 systemRandom（Math.random），
 * 离线验证时使用 createSeededRandom(seed) 得到完全可复现的序列。
 */
export type RandomSource = () => number;

/** 不可复现的默认随机源（仅浏览器实时运行时使用）。 */
export const systemRandom: RandomSource = () => Math.random();

/**
 * mulberry32 伪随机数生成器：同一 seed 产生完全相同的 [0, 1) 序列。
 */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
