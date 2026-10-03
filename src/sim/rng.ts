/**
 * 确定性随机数生成器（mulberry32）。
 * 相同的 seed 产生完全相同的随机序列，是模拟可回放的基础。
 * 模拟逻辑（鱼群、食物、装饰物）必须使用它，禁止直接使用 Math.random()。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // 保证 state 为 32 位无符号整数
    this.state = seed >>> 0;
  }

  /** 返回 [0, 1) 区间的浮点数 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [min, max) 区间的浮点数 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** 以 0.5 概率返回 true/false（替代 Math.random() > 0.5） */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 导出内部状态，可用于快照/恢复 */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
