export type DisplayMode = 'normal' | 'threads' | 'particles'

export const HIGHLIGHT_NONE = 0
export const HIGHLIGHT_NEIGHBOR = 1
export const HIGHLIGHT_PRIMARY = 2

/**
 * 交互状态的唯一来源：悬停、锁定、高亮进度、缩放系数、显示模式。
 * 渲染层每帧从这里推导尺寸、透明度、标签与可见性，不直接持有交互状态。
 */
export class ViewerState {
  public hoveredId: number | null = null
  public lockedId: number | null = null
  public scaleFactor: number = 1.0
  public displayMode: DisplayMode = 'normal'

  private readonly neighbors: number[][]
  private readonly highlightLevels: number[]

  constructor(neighbors: number[][]) {
    this.neighbors = neighbors
    this.highlightLevels = new Array<number>(neighbors.length).fill(HIGHLIGHT_NONE)
  }

  public get count(): number {
    return this.neighbors.length
  }

  public setHovered(id: number | null): void {
    this.hoveredId = id
  }

  public setLocked(id: number | null): void {
    this.lockedId = id
  }

  public setScaleFactor(scale: number): void {
    this.scaleFactor = scale
  }

  public setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode
  }

  public resetInteraction(): void {
    this.hoveredId = null
    this.lockedId = null
    this.highlightLevels.fill(HIGHLIGHT_NONE)
  }

  public isPrimary(id: number): boolean {
    return id === this.hoveredId || id === this.lockedId
  }

  public getHighlightLevel(id: number): number {
    return this.highlightLevels[id]
  }

  public targetHighlightLevel(id: number): number {
    if (this.isPrimary(id)) return HIGHLIGHT_PRIMARY
    if (this.isNeighborOfActive(id)) return HIGHLIGHT_NEIGHBOR
    return HIGHLIGHT_NONE
  }

  private isNeighborOfActive(id: number): boolean {
    const actives = [this.hoveredId, this.lockedId]
    for (const active of actives) {
      if (active !== null && this.neighbors[active].includes(id)) return true
    }
    return false
  }

  /**
   * 高亮进度向目标值推进：上升沿形成约 1 秒的波浪扩散，下降沿快速消退。
   */
  public tickHighlights(delta: number): void {
    const riseSpeed = HIGHLIGHT_PRIMARY / 1.0
    const fallSpeed = 1.5
    for (let i = 0; i < this.highlightLevels.length; i++) {
      const target = this.targetHighlightLevel(i)
      const level = this.highlightLevels[i]
      if (level < target) {
        this.highlightLevels[i] = Math.min(target, level + delta * riseSpeed)
      } else if (level > target) {
        this.highlightLevels[i] = Math.max(target, level - delta * fallSpeed)
      }
    }
  }
}
