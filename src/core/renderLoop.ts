export interface RafScheduler {
  request: (callback: (time: number) => void) => number
  cancel: (id: number) => void
}

const defaultScheduler: RafScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
}

/**
 * A requestAnimationFrame loop whose start/stop lifecycle is explicit and
 * independent of any UI framework state. The frame callback reads whatever
 * live state it needs each frame, so changing playback/seek/mode never
 * requires rebuilding the loop.
 *
 * start()/stop() are idempotent and counted, which makes the loop's
 * behaviour directly verifiable in tests.
 */
export class RenderLoop {
  private rafId: number | null = null
  private running = false

  startCount = 0
  stopCount = 0
  frameCount = 0

  constructor(
    private readonly frame: (time: number) => void,
    private readonly scheduler: RafScheduler = defaultScheduler,
  ) {}

  get isRunning(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.startCount += 1
    this.scheduleNext()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.stopCount += 1
    if (this.rafId !== null) {
      this.scheduler.cancel(this.rafId)
      this.rafId = null
    }
  }

  private scheduleNext(): void {
    this.rafId = this.scheduler.request(this.tick)
  }

  private tick = (time: number): void => {
    if (!this.running) return
    this.frameCount += 1
    this.frame(time)
    if (this.running) {
      this.scheduleNext()
    }
  }
}
