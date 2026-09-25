import { BarMeshGroup, BarHoverCallback, BarClickCallback } from './types';

/**
 * 交互状态层：悬停、选中、详情模式的单一可信来源。
 * 所有状态迁移（悬停切换、点击进入详情、再次点击退出、
 * 数据切换时重置）都经过这里，并统一向外发出回调。
 */
export class InteractionState {
  private hovered: BarMeshGroup | null = null;
  private selected: BarMeshGroup | null = null;
  private detail = false;

  private onHover: BarHoverCallback | null = null;
  private onClick: BarClickCallback | null = null;

  constructor(private readonly getBars: () => readonly BarMeshGroup[]) {}

  setHoverCallback(cb: BarHoverCallback | null): void {
    this.onHover = cb;
  }

  setClickCallback(cb: BarClickCallback | null): void {
    this.onClick = cb;
  }

  get hoveredBar(): BarMeshGroup | null {
    return this.hovered;
  }

  get selectedBar(): BarMeshGroup | null {
    return this.selected;
  }

  get isDetailMode(): boolean {
    return this.detail;
  }

  /** 更新悬停柱体；发生变化时同步高亮标记并发出悬停回调。 */
  setHovered(bar: BarMeshGroup | null, screenX = 0, screenY = 0): void {
    if (bar === this.hovered) return;
    if (this.hovered) this.hovered.isHighlighted = false;
    this.hovered = bar;
    if (bar) {
      bar.isHighlighted = true;
      if (this.onHover) this.onHover(bar.data, screenX, screenY);
    } else {
      if (this.onHover) this.onHover(null, 0, 0);
    }
  }

  /** 点击柱体：进入详情模式；再次点击同一柱体则退出详情。 */
  handleBarClick(bar: BarMeshGroup): void {
    if (this.detail && this.selected === bar) {
      this.exitDetail();
      return;
    }

    this.selected = bar;
    this.detail = true;
    const centerIdx = bar.index;

    this.getBars().forEach(b => {
      const dist = Math.abs(b.index - centerIdx);
      if (dist <= 2) {
        b.targetOpacity = 1;
        b.isHighlighted = b.index === centerIdx;
        b.targetScale.set(1.4, 1.4, 1.4);
      } else {
        b.targetOpacity = 0.15;
        b.isHighlighted = false;
        b.targetScale.set(0.8, 0.8, 0.8);
      }
    });

    if (this.onClick) this.onClick(bar.data);
  }

  /** 退出详情模式，恢复所有柱体的目标透明度与缩放。 */
  exitDetail(): void {
    this.detail = false;
    this.selected = null;
    this.getBars().forEach(b => {
      b.targetOpacity = 1;
      b.isHighlighted = false;
      b.targetScale.set(1, 1, 1);
    });
    if (this.onClick) this.onClick(null);
  }

  /**
   * 数据切换时重置全部交互状态。
   * 旧柱体上的悬停/选中引用一律失效，避免残留状态错位到新数据。
   */
  reset(): void {
    if (this.hovered) {
      this.hovered.isHighlighted = false;
      this.hovered = null;
      if (this.onHover) this.onHover(null, 0, 0);
    }
    this.selected = null;
    this.detail = false;
    if (this.onClick) this.onClick(null);
  }
}
