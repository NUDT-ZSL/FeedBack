/**
 * 可注入的时间源与帧调度抽象。
 * 浏览器环境使用 Date.now / requestAnimationFrame；
 * 离线验证使用 ManualClock / ManualFrameRunner 手动推进时间，保证可复现。
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now()
};

/** 手动时钟：只能由测试代码显式推进 */
export class ManualClock implements Clock {
  private current: number;
  constructor(start: number = 0) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

export interface FrameRunner {
  /** 调度下一帧回调，语义与 requestAnimationFrame 一致 */
  requestFrame(cb: () => void): void;
}

/** 浏览器帧调度器 */
export const animationFrameRunner: FrameRunner = {
  requestFrame: (cb) => requestAnimationFrame(() => cb())
};

/**
 * 手动帧调度器：回调进入队列，由 step() 同步执行，
 * 使依赖帧驱动的动画（如采集飞行）可以离线、确定性地跑完。
 */
export class ManualFrameRunner implements FrameRunner {
  private queue: Array<() => void> = [];
  requestFrame(cb: () => void): void {
    this.queue.push(cb);
  }
  /** 执行一帧；返回是否还有待执行的帧 */
  step(): boolean {
    const pending = this.queue;
    this.queue = [];
    pending.forEach((cb) => cb());
    return this.queue.length > 0;
  }
  /** 连续执行直到没有新的帧被调度，或超过 maxSteps 防止死循环 */
  runUntilIdle(maxSteps: number = 10000): void {
    let steps = 0;
    while (this.queue.length > 0) {
      if (++steps > maxSteps) {
        throw new Error(`ManualFrameRunner: 超过 ${maxSteps} 帧仍未结束，疑似死循环`);
      }
      this.step();
    }
  }
  get pendingCount(): number {
    return this.queue.length;
  }
}
