/**
 * 可播种的确定性随机数工具。
 *
 * 印刷链路（版心偏移、墨色均匀度、断墨白点、纸纹噪点）原来直接调用
 * Math.random()，同一份印刷记录重复渲染会得到不同结果，无法离线回归。
 * 统一使用 mulberry32：给定相同 seed 产生完全相同的随机序列，
 * 需要非确定性的交互场景仍可显式传入 Math.random。
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
