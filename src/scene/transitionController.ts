/**
 * 过渡动画层：集中管理淡入进度与"淡出后切换数据"的调度。
 * 通过代际令牌保证连续切换股票时只有最后一次调度生效，
 * 不会残留过期定时器把新数据清掉。
 */
export class TransitionController {
  private fadeProgress = 1;
  private fadingIn = false;
  private generation = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  /** 开始一轮淡入（新数据加载后调用）。 */
  beginFadeIn(): void {
    this.fadeProgress = 0;
    this.fadingIn = true;
  }

  /**
   * 延迟执行一次数据切换。若已有未执行的切换，先取消，
   * 确保任何时刻最多只有一个待执行的切换任务。
   */
  scheduleSwap(task: () => void, delayMs: number): void {
    this.cancelPending();
    const gen = ++this.generation;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      if (gen !== this.generation) return;
      task();
    }, delayMs);
  }

  /** 取消尚未执行的切换任务（例如直接加载新数据时）。 */
  cancelPending(): void {
    this.generation++;
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  update(delta: number): void {
    if (!this.fadingIn) return;
    this.fadeProgress += delta * 1.25;
    if (this.fadeProgress >= 1) {
      this.fadeProgress = 1;
      this.fadingIn = false;
    }
  }

  /** 淡入期间的全局透明度系数，淡入结束后恒为 1。 */
  get baseOpacity(): number {
    return this.fadingIn ? this.fadeProgress : 1;
  }

  /** 释放时调用：取消定时器并复位进度。 */
  reset(): void {
    this.cancelPending();
    this.fadeProgress = 1;
    this.fadingIn = false;
  }
}
