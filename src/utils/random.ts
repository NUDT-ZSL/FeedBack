/**
 * 可种子化的确定性随机源。
 *
 * 印刷链路中所有原本直接调用 Math.random() 的环节（版心偏移、墨色
 * 均匀度、断墨白点、纸张纹理）都改为使用 Rng。相同种子必定产生相同
 * 序列，从而保证同一份印刷记录重复渲染时成品稳定可复现，也让离线
 * 验证可以在不依赖浏览器的前提下精确回归。
 */

export type Rng = () => number;

/** mulberry32：轻量、快速、分布均匀的确定性伪随机数生成器，返回 [0, 1)。 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 风格哈希，把字符串/数字/布尔组合成一个 32 位无符号种子。 */
export function hashSeed(parts: ReadonlyArray<string | number | boolean>): number {
  let hash = 2166136261 >>> 0;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    // 分隔位，避免 [1, 23] 与 [12, 3] 产生相同种子
    hash ^= 31;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 在同一个印刷种子上派生出互不干扰的随机流（偏移、均匀度、逐字判定等）。 */
export function streamRng(seed: number, salt: string): Rng {
  return mulberry32(hashSeed([seed, salt]));
}
