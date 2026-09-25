/**
 * 频段时间平滑器。
 *
 * 播放中：非对称 attack/release 指数平滑。
 * 相邻帧的最大变化量被限制为 (1 - exp(-dt / tau)) * |raw - smoothed|，
 * 上升沿（attackTau）响应快，下降沿（releaseTau）稍慢，消除能量跳变导致的闪烁。
 *
 * 暂停 / 播放结束：切换到独立的纯指数回落曲线（pauseDecayTau），
 * 单调衰减到 0，时间常数与曲线形态都与播放中的实时跟踪明显区分。
 */
export class BandSmoother {
  private smoothed: number[] = [];
  private lastTimeMs: number | null = null;

  constructor(
    private readonly attackTau: number = 0.05,
    private readonly releaseTau: number = 0.18,
    private readonly pauseDecayTau: number = 0.35,
    private readonly epsilon: number = 0.001
  ) {}

  reset(): void {
    this.smoothed = [];
    this.lastTimeMs = null;
  }

  getValues(): number[] {
    return [...this.smoothed];
  }

  update(rawBands: number[], isPlaying: boolean, nowMs?: number): number[] {
    const now = nowMs ?? performance.now();
    const dt =
      this.lastTimeMs === null
        ? 1 / 60
        : Math.min(Math.max((now - this.lastTimeMs) / 1000, 0), 0.1);
    this.lastTimeMs = now;

    if (this.smoothed.length !== rawBands.length) {
      this.smoothed = new Array(rawBands.length).fill(0);
    }

    if (!isPlaying) {
      // 暂停回落：固定时间常数的指数衰减，单调趋向静止
      const decay = Math.exp(-dt / this.pauseDecayTau);
      for (let i = 0; i < this.smoothed.length; i++) {
        const next = this.smoothed[i] * decay;
        this.smoothed[i] = next < this.epsilon ? 0 : next;
      }
      return [...this.smoothed];
    }

    for (let i = 0; i < this.smoothed.length; i++) {
      const raw = Math.max(0, Math.min(1, rawBands[i]));
      const tau = raw > this.smoothed[i] ? this.attackTau : this.releaseTau;
      const alpha = 1 - Math.exp(-dt / tau);
      this.smoothed[i] += (raw - this.smoothed[i]) * alpha;
    }
    return [...this.smoothed];
  }
}
