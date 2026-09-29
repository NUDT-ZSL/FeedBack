import type { AudioEngine } from './audioEngine'
import { computeCanvasSize, type CanvasSize } from './canvasSize'
import { drawScene, type VizMode } from './draw'
import { RenderLoop, type RafScheduler } from './renderLoop'

export interface VisualizerControllerDeps {
  scheduler?: RafScheduler
  devicePixelRatio?: () => number
}

/**
 * Owns everything the visualizer needs outside of React: the render loop,
 * canvas backing-store sizing and per-frame drawing. The loop starts once
 * on attach and stops once on detach; playback state, seeking and viz mode
 * are read live each frame, so none of them ever rebuild the loop.
 */
export class VisualizerController {
  readonly loop: RenderLoop

  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private resizeObserver: ResizeObserver | null = null
  private canvasSize: CanvasSize = { width: 800, height: 400 }

  constructor(
    private readonly engine: AudioEngine,
    private readonly getMode: () => VizMode,
    private readonly deps: VisualizerControllerDeps = {},
  ) {
    this.loop = new RenderLoop(this.drawFrame, deps.scheduler)
  }

  get size(): CanvasSize {
    return this.canvasSize
  }

  attach(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas) return
    this.detach()
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.syncCanvasSize()
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.syncCanvasSize())
      this.resizeObserver.observe(canvas)
    }
    this.loop.start()
  }

  detach(): void {
    this.loop.stop()
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
    this.canvas = null
    this.ctx = null
  }

  /**
   * Recomputes the backing-store size from the element's CSS box and the
   * device pixel ratio. Drawing always uses these exact dimensions, so a
   * resize can never stretch or crop the scene.
   */
  syncCanvasSize(): CanvasSize {
    if (!this.canvas) return this.canvasSize
    const rect = this.canvas.getBoundingClientRect()
    const dpr =
      this.deps.devicePixelRatio?.() ??
      (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ??
      1
    const cssWidth = rect.width > 0 ? rect.width : this.canvasSize.width
    const cssHeight = rect.height > 0 ? rect.height : this.canvasSize.height
    const size = computeCanvasSize(cssWidth, cssHeight, dpr)
    if (this.canvas.width !== size.width) this.canvas.width = size.width
    if (this.canvas.height !== size.height) this.canvas.height = size.height
    this.canvasSize = size
    return size
  }

  private drawFrame = (): void => {
    const ctx = this.ctx
    if (!ctx) return
    const snapshot = this.engine.getSnapshot()
    drawScene(ctx, {
      analyzer: this.engine.analyzers.current,
      isPlaying: snapshot.isPlaying,
      isSeeking: snapshot.isSeeking,
      mode: this.getMode(),
      width: this.canvasSize.width,
      height: this.canvasSize.height,
    })
  }
}
