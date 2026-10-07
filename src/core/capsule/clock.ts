/** 可注入时钟：时间相关逻辑全部通过 Clock 获取，测试可精确控制边界时刻 */
export interface Clock {
  now(): number
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now()
  }
}

/** 手动时钟：测试专用，可定点设置或按步长推进 */
export class ManualClock implements Clock {
  private current: number

  constructor(start = 0) {
    this.current = start
  }

  now(): number {
    return this.current
  }

  set(time: number): void {
    this.current = time
  }

  advance(ms: number): void {
    this.current += ms
  }
}
