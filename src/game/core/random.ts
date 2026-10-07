/**
 * 可注入的随机源抽象。
 * 游戏内所有随机性都必须来自 RandomSource，禁止直接调用 Math.random()，
 * 以便离线验证时注入确定性种子，得到完全可复现的结果。
 */
export interface RandomSource {
  /** 返回 [0, 1) 区间的伪随机数 */
  next(): number;
}

/** mulberry32：小巧、确定性良好的种子随机数生成器 */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
}

/** 浏览器默认随机源（不可复现，仅用于真实游戏运行） */
export const mathRandomSource: RandomSource = {
  next: () => Math.random()
};

/** 基于随机源的确定性 id 生成器（替代 Date.now + Math.random 的写法） */
export function createIdGenerator(prefix: string, random: RandomSource): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    const rand = Math.floor(random.next() * 0xffffffff).toString(36);
    return `${prefix}_${counter.toString(36)}_${rand}`;
  };
}
