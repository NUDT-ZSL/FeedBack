/**
 * Owns the fade-in progress and the deferred data-swap timer used
 * when transitioning between stocks. Only one pending transition
 * may exist at a time; scheduling a new one cancels the previous.
 */
export class TransitionController {
  private fadeProgress = 1;
  private fadingIn = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  get isFadingIn(): boolean {
    return this.fadingIn;
  }

  get progress(): number {
    return this.fadeProgress;
  }

  beginFadeIn() {
    this.fadeProgress = 0;
    this.fadingIn = true;
  }

  update(delta: number) {
    if (!this.fadingIn) return;
    this.fadeProgress += delta * 1.25;
    if (this.fadeProgress >= 1) {
      this.fadeProgress = 1;
      this.fadingIn = false;
    }
  }

  schedule(delayMs: number, fn: () => void) {
    this.cancelPending();
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      fn();
    }, delayMs);
  }

  cancelPending() {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  dispose() {
    this.cancelPending();
  }
}
