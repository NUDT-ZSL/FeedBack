import * as THREE from 'three';
import { BarMeshGroup, BarHoverCallback, BarClickCallback } from './types';

const FOCUS_RADIUS = 2;
const DIMMED_OPACITY = 0.15;
const FOCUSED_SCALE = 1.4;
const DIMMED_SCALE = 0.8;

/**
 * Single source of truth for hover / selection / detail-mode state.
 * All mutations go through this class so the scene manager, raycast
 * handling and data swaps can never disagree about the current state.
 */
export class InteractionState {
  private hovered: BarMeshGroup | null = null;
  private selected: BarMeshGroup | null = null;
  private detailMode = false;

  onHover: BarHoverCallback | null = null;
  onClick: BarClickCallback | null = null;

  get hoveredBar(): BarMeshGroup | null {
    return this.hovered;
  }

  get isDetailMode(): boolean {
    return this.detailMode;
  }

  setHover(bar: BarMeshGroup | null, screenX = 0, screenY = 0) {
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

  clearHover() {
    this.setHover(null);
  }

  clickBar(bar: BarMeshGroup, bars: readonly BarMeshGroup[]) {
    if (this.detailMode && this.selected === bar) {
      this.exitDetail(bars);
      return;
    }

    this.selected = bar;
    this.detailMode = true;
    const centerIdx = bar.index;

    bars.forEach(b => {
      const dist = Math.abs(b.index - centerIdx);
      if (dist <= FOCUS_RADIUS) {
        b.targetOpacity = 1;
        b.isHighlighted = b.index === centerIdx;
        b.targetScale = new THREE.Vector3(FOCUSED_SCALE, FOCUSED_SCALE, FOCUSED_SCALE);
      } else {
        b.targetOpacity = DIMMED_OPACITY;
        b.isHighlighted = false;
        b.targetScale = new THREE.Vector3(DIMMED_SCALE, DIMMED_SCALE, DIMMED_SCALE);
      }
    });

    if (this.onClick) this.onClick(bar.data);
  }

  clickBlank(bars: readonly BarMeshGroup[]) {
    if (this.detailMode) this.exitDetail(bars);
  }

  exitDetail(bars: readonly BarMeshGroup[]) {
    this.detailMode = false;
    this.selected = null;
    bars.forEach(b => {
      b.targetOpacity = 1;
      b.isHighlighted = false;
      b.targetScale = new THREE.Vector3(1, 1, 1);
    });
    if (this.onClick) this.onClick(null);
  }

  /**
   * Called whenever the bar data set is replaced. Drops any hover or
   * selection that pointed at the old bars so no stale highlight or
   * tooltip survives a stock switch.
   */
  resetForDataChange() {
    if (this.hovered) {
      this.hovered.isHighlighted = false;
      this.hovered = null;
      if (this.onHover) this.onHover(null, 0, 0);
    }
    this.selected = null;
    this.detailMode = false;
    if (this.onClick) this.onClick(null);
  }
}
