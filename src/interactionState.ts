export type DisplayMode = 'normal' | 'threads' | 'particles'

export class InteractionState {
  public hoveredId: number | null = null
  public lockedId: number | null = null
  public scaleFactor: number = 1.0
  public displayMode: DisplayMode = 'normal'
  public focusStartedAt: number = 0

  public get activeId(): number | null {
    return this.lockedId !== null ? this.lockedId : this.hoveredId
  }

  public hover(id: number | null, now: number): void {
    if (this.hoveredId === id) return
    this.hoveredId = id
    if (this.lockedId === null) {
      this.focusStartedAt = now
    }
  }

  public lock(id: number | null, now: number): void {
    if (this.lockedId === id) return
    this.lockedId = id
    this.focusStartedAt = now
  }

  public reset(): void {
    this.hoveredId = null
    this.lockedId = null
    this.focusStartedAt = 0
  }
}
