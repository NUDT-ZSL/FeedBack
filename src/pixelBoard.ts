export interface PixelBoardOptions {
  canvasSize: number
  gridSize: number
  canvas: HTMLCanvasElement
  createExportCanvas?: (size: number) => HTMLCanvasElement
  requestFrame?: (cb: (time: number) => void) => void
  now?: () => number
  animationDuration?: number
}

interface AnimationEntry {
  key: string
  gridX: number
  gridY: number
  cellSize: number
  color: string
  startTime: number
  epoch: number
}

const DEFAULT_ANIMATION_DURATION = 150

export class PixelBoard {
  private cells = new Map<string, string>()
  private animations = new Map<string, AnimationEntry>()
  private epoch = 0
  private gridSize: number
  private readonly canvasSize: number
  private readonly canvas: HTMLCanvasElement
  private readonly createExportCanvas: (size: number) => HTMLCanvasElement
  private readonly requestFrame: (cb: (time: number) => void) => void
  private readonly now: () => number
  private readonly animationDuration: number

  constructor(options: PixelBoardOptions) {
    this.canvasSize = options.canvasSize
    this.gridSize = options.gridSize
    this.canvas = options.canvas
    this.createExportCanvas =
      options.createExportCanvas ??
      ((size: number) => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        return canvas
      })
    this.requestFrame = options.requestFrame ?? ((cb) => requestAnimationFrame(cb))
    this.now = options.now ?? (() => performance.now())
    this.animationDuration = options.animationDuration ?? DEFAULT_ANIMATION_DURATION
  }

  get cellSize(): number {
    return this.canvasSize / this.gridSize
  }

  get currentGridSize(): number {
    return this.gridSize
  }

  paintCell(gridX: number, gridY: number, color: string): void {
    if (gridX < 0 || gridX >= this.gridSize || gridY < 0 || gridY >= this.gridSize) return
    const key = `${gridX},${gridY}`
    this.cells.set(key, color)
    this.startAnimation(gridX, gridY, key, color)
  }

  clear(): void {
    this.reset()
  }

  setGridSize(gridSize: number): void {
    this.gridSize = gridSize
    this.reset()
  }

  exportDataURL(): string {
    const exportCanvas = this.createExportCanvas(this.canvasSize)
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) return ''
    this.renderSettledCells(ctx)
    return exportCanvas.toDataURL('image/png')
  }

  snapshotCells(): Map<string, string> {
    return new Map(this.cells)
  }

  dispose(): void {
    this.epoch++
    this.animations.clear()
  }

  private reset(): void {
    this.epoch++
    this.cells.clear()
    this.animations.clear()
    const ctx = this.canvas.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, this.canvasSize, this.canvasSize)
  }

  private renderSettledCells(ctx: CanvasRenderingContext2D): void {
    const cellSize = this.cellSize
    for (const [key, color] of this.cells) {
      const [gx, gy] = key.split(',').map(Number)
      ctx.fillStyle = color
      ctx.fillRect(gx * cellSize, gy * cellSize, cellSize, cellSize)
    }
  }

  private startAnimation(gridX: number, gridY: number, key: string, color: string): void {
    const cellSize = this.cellSize
    const entry: AnimationEntry = {
      key,
      gridX,
      gridY,
      cellSize,
      color,
      startTime: this.now(),
      epoch: this.epoch,
    }
    this.animations.set(key, entry)
    const centerX = gridX * cellSize + cellSize / 2
    const centerY = gridY * cellSize + cellSize / 2
    const maxRadius = cellSize / 2
    const animate = (time: number) => {
      if (this.animations.get(key) !== entry || entry.epoch !== this.epoch) return
      const ctx = this.canvas.getContext('2d')
      if (!ctx) {
        this.animations.delete(key)
        return
      }
      const elapsed = time - entry.startTime
      const progress = Math.min(elapsed / this.animationDuration, 1)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      const currentRadius = maxRadius * easeOut
      ctx.save()
      ctx.beginPath()
      ctx.rect(gridX * cellSize, gridY * cellSize, cellSize, cellSize)
      ctx.clip()
      ctx.fillStyle = entry.color
      ctx.beginPath()
      ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      if (progress < 1) {
        this.requestFrame(animate)
      } else {
        ctx.fillStyle = entry.color
        ctx.fillRect(gridX * cellSize, gridY * cellSize, cellSize, cellSize)
        this.animations.delete(key)
      }
    }
    this.requestFrame(animate)
  }
}
