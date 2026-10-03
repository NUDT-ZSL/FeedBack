/**
 * mulberry32：确定性伪随机数生成器。
 * 相同种子产生完全相同的序列，不依赖任何外部状态。
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 将任意数值种子规范化为 32 位无符号整数 */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.abs(Math.trunc(seed)) >>> 0;
}
