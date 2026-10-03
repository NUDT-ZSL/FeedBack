import type { GridSize } from './types'

export const CANVAS_SIZE = 400
export const FILL_DURATION_MS = 150
export const GRID_LINE_COLOR = 'rgba(212, 201, 176, 0.3)'

export interface PaintCell {
  x: number
  y: number
}

interface CellAnimation {
  startTime: number
  color: string
  baseColor: string | null
  epoch: number
}

export interface RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  save(): void
  restore(): void
  beginPath(): void
  rect(x: number, y: number, w: number, h: number): void
  clip(): void
  arc(x: number, y: number, r: number, startAngle: number, endAngle: number): void
  fill(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`
}

function parseCellKey(key: string): { x: number; y: number } {
  const comma = key.indexOf(',')
  return { x: Number(key.slice(0, comma)), y: Number(key.slice(comma + 1)) }
}

export function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return hex
  const r = parseInt(result[1], 16)
  const g = parseInt(result[2], 16)
  const b = parseInt(result[3], 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function brushCells(centerX: number, centerY: number, brushSize: number): PaintCell[] {
  const halfBrush = Math.floor(brushSize / 2)
  const cells: PaintCell[] = []
  for (let dx = -halfBrush; dx <= halfBrush; dx++) {
    for (let dy = -halfBrush; dy <= halfBrush; dy++) {
      if (brushSize % 2 === 0 && (dx === halfBrush || dy === halfBrush)) continue
      cells.push({ x: centerX + dx, y: centerY + dy })
    }
  }
  return cells
}

export class PixelBoard {
  private cells = new Map<string, string>()
  private animations = new Map<string, CellAnimation>()
  private epoch = 0

  constructor(public gridSize: GridSize = 16) {}

  get cellSize(): number {
    return CANVAS_SIZE / this.gridSize
  }

  get pixelCount(): number {
    return this.cells.size
  }

  get animationCount(): number {
    return this.animations.size
  }

  getEpoch(): number {
    return this.epoch
  }

  paint(cellsToPaint: PaintCell[], color: string, now: number): number {
    let painted = 0
    for (const cell of cellsToPaint) {
      if (cell.x < 0 || cell.y < 0 || cell.x >= this.gridSize || cell.y >= this.gridSize) {
        continue
      }
      const key = cellKey(cell.x, cell.y)
      const baseColor = this.cells.get(key) ?? null
      this.cells.set(key, color)
      this.animations.set(key, {
        startTime: now,
        color,
        baseColor,
        epoch: this.epoch,
      })
      painted++
    }
    return painted
  }

  clear(): void {
    this.cells.clear()
    this.animations.clear()
    this.epoch++
  }

  setGridSize(size: GridSize): void {
    if (size === this.gridSize) return
    this.gridSize = size
    this.clear()
  }

  hasActiveAnimations(now: number): boolean {
    for (const animation of this.animations.values()) {
      if (animation.epoch !== this.epoch) continue
      if (now - animation.startTime < FILL_DURATION_MS) return true
    }
    return false
  }

  private pruneAnimations(now: number): void {
    for (const [key, animation] of this.animations) {
      if (animation.epoch !== this.epoch || now - animation.startTime >= FILL_DURATION_MS) {
        this.animations.delete(key)
      }
    }
  }

  renderTo(ctx: RenderContext, now: number): void {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    const size = this.cellSize
    for (const [key, color] of this.cells) {
      const { x: gx, y: gy } = parseCellKey(key)
      const animation = this.animations.get(key)
      const active =
        animation !== undefined &&
        animation.epoch === this.epoch &&
        now - animation.startTime < FILL_DURATION_MS
      const px = gx * size
      const py = gy * size
      if (!active) {
        ctx.fillStyle = color
        ctx.fillRect(px, py, size, size)
        continue
      }
      if (animation.baseColor !== null) {
        ctx.fillStyle = animation.baseColor
        ctx.fillRect(px, py, size, size)
      }
      const progress = Math.min(Math.max((now - animation.startTime) / FILL_DURATION_MS, 0), 1)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      const radius = (size / 2) * easeOut
      const centerX = px + size / 2
      const centerY = py + size / 2
      ctx.save()
      ctx.beginPath()
      ctx.rect(px, py, size, size)
      ctx.clip()
      ctx.fillStyle = animation.color
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    this.pruneAnimations(now)
  }

  renderSettledTo(ctx: RenderContext): void {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    const size = this.cellSize
    for (const [key, color] of this.cells) {
      const { x: gx, y: gy } = parseCellKey(key)
      ctx.fillStyle = color
      ctx.fillRect(gx * size, gy * size, size, size)
    }
  }

  snapshot(): Array<{ x: number; y: number; color: string }> {
    return Array.from(this.cells, ([key, color]) => ({ ...parseCellKey(key), color }))
  }
}

export function renderGrid(ctx: RenderContext, gridSize: GridSize): void {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  const size = CANVAS_SIZE / gridSize
  ctx.strokeStyle = GRID_LINE_COLOR
  ctx.lineWidth = 0.5
  for (let i = 0; i <= gridSize; i++) {
    ctx.beginPath()
    ctx.moveTo(i * size, 0)
    ctx.lineTo(i * size, CANVAS_SIZE)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i * size)
    ctx.lineTo(CANVAS_SIZE, i * size)
    ctx.stroke()
  }
}

export interface HoverPreviewOptions {
  gridSize: GridSize
  brushSize: number
  color: string
  opacity: number
  hoverX: number
  hoverY: number
}

export function renderHoverPreview(ctx: RenderContext, options: HoverPreviewOptions): void {
  const { gridSize, brushSize, color, opacity, hoverX, hoverY } = options
  renderGrid(ctx, gridSize)
  const size = CANVAS_SIZE / gridSize
  const previewColor = hexToRgba(color, opacity * 0.5)
  const scale = 1.2
  const offset = (size * (scale - 1)) / 2
  ctx.save()
  for (const cell of brushCells(hoverX, hoverY, brushSize)) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= gridSize || cell.y >= gridSize) continue
    const px = cell.x * size
    const py = cell.y * size
    ctx.fillStyle = previewColor
    ctx.fillRect(px - offset, py - offset, size * scale, size * scale)
  }
  ctx.restore()
}
