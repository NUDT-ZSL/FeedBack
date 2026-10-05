/**
 * 可快照、可复现的确定性伪随机数生成器（mulberry32）。
 * 状态是单个 uint32，可随 EngineState 快照/恢复，保证增量重推
 * 与整体重推的随机抽取顺序（出生 x、装甲判定、弹幕形态）完全一致。
 */
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
