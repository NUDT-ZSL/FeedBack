/**
 * 频段/波形数据的时间维度平滑器。
 *
 * 播放中：攻击(上升)与释放(下降)使用不同时间常数的指数平滑，
 * 保证响应速度的同时抑制相邻帧之间的能量跳变。
 * 暂停/播放结束：切换到独立的回落曲线(easeInOutCubic 的镜像)，
 * 在固定时长内自然衰减到静止值，且保证最终精确到达静止值。
 */
export interface SpectralSmootherConfig {
  /** 上升时间常数(秒)，越小响应越快 */
  attackTau: number;
  /** 播放中下降时间常数(秒) */
  releaseTau: number;
  /** 静止值(频段为 0，波形为 0.5) */
  restValue: number;
  /** 暂停/结束后的回落总时长(秒) */
  pauseDecayDuration: number;
  /** 小于该值时吸附到静止值，避免尾音抖动 */
  epsilon: number;
}

export const BAND_SMOOTHER_CONFIG: SpectralSmootherConfig = {
  attackTau: 0.045,
  releaseTau: 0.16,
  restValue: 0,
  pauseDecayDuration: 0.8,
  epsilon: 0.001
};

export const WAVEFORM_SMOOTHER_CONFIG: SpectralSmootherConfig = {
  attackTau: 0.06,
  releaseTau: 0.06,
  restValue: 0.5,
  pauseDecayDuration: 0.8,
  epsilon: 0.001
};

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class SpectralSmoother {
  private values: number[] = [];
  private pauseStartValues: number[] = [];
  private pauseElapsed: number = 0;
  private decaying: boolean = false;

  constructor(private readonly config: SpectralSmootherConfig) {}

  reset(): void {
    this.values = [];
    this.pauseStartValues = [];
    this.pauseElapsed = 0;
    this.decaying = false;
  }

  /**
   * @param raw 当前帧的原始数据(0..1)
   * @param deltaSeconds 距上次调用的真实时间间隔(秒)
   * @param active 是否正在播放；false 时进入暂停回落
   */
  update(raw: number[], deltaSeconds: number, active: boolean): number[] {
    if (this.values.length !== raw.length) {
      this.values = new Array(raw.length).fill(this.config.restValue);
      this.decaying = false;
    }

    const dt = Math.max(0, Math.min(deltaSeconds, 0.1));

    if (active) {
      this.decaying = false;
      this.pauseElapsed = 0;
      for (let i = 0; i < raw.length; i++) {
        const target = Math.max(0, Math.min(1, raw[i]));
        const current = this.values[i];
        const tau = target > current ? this.config.attackTau : this.config.releaseTau;
        const k = 1 - Math.exp(-dt / tau);
        let next = current + (target - current) * k;
        if (
          Math.abs(next - this.config.restValue) < this.config.epsilon &&
          Math.abs(target - this.config.restValue) < this.config.epsilon
        ) {
          next = this.config.restValue;
        }
        this.values[i] = next;
      }
    } else {
      if (!this.decaying) {
        this.decaying = true;
        this.pauseElapsed = 0;
        this.pauseStartValues = this.values.slice();
      }
      this.pauseElapsed += dt;
      const duration = Math.max(this.config.pauseDecayDuration, 1e-6);
      const t = Math.min(1, this.pauseElapsed / duration);
      // 与播放中的指数释放不同的回落曲线：先缓后快再缓，且精确到 0
      const factor = 1 - easeInOutCubic(t);
      for (let i = 0; i < this.values.length; i++) {
        const start = this.pauseStartValues[i] ?? this.config.restValue;
        this.values[i] = this.config.restValue + (start - this.config.restValue) * factor;
      }
      if (t >= 1) {
        this.values.fill(this.config.restValue);
      }
    }

    return this.values.slice();
  }

  getValues(): number[] {
    return this.values.slice();
  }

  isSettled(): boolean {
    return this.values.every(
      v => Math.abs(v - this.config.restValue) < this.config.epsilon
    );
  }
}
