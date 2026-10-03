import { Rng } from './rng';

export type DecorationType = 'coral' | 'shell' | 'wreck';

export interface Decoration {
  id: number;
  type: DecorationType;
  x: number;
  y: number;
  scale: number;
}

export interface PlaceResult {
  decoration: Decoration;
  /** 请求坐标超出鱼缸范围、被夹取回边界内时为 true */
  clamped: boolean;
}

/**
 * 装饰物状态管理（纯逻辑，无渲染）。
 * 放置坐标会被确定性地夹取到鱼缸范围内：
 * x ∈ [0, width]，y ∈ [height - 100, height]（装饰物只能落在底部区域）。
 */
export class DecorationManager {
  private decorations: Decoration[] = [];
  private idCounter = 0;
  private rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  place(type: DecorationType, x: number, y: number, width: number, height: number): PlaceResult {
    const clampedX = Math.max(0, Math.min(width, x));
    const clampedY = Math.max(height - 100, Math.min(height, y));
    const clamped = clampedX !== x || clampedY !== y;
    const decoration: Decoration = {
      id: this.idCounter++,
      type,
      x: clampedX,
      y: clampedY,
      scale: 0.8 + this.rng.next() * 0.4
    };
    this.decorations.push(decoration);
    return { decoration, clamped };
  }

  getAll(): readonly Decoration[] {
    return this.decorations;
  }

  get count(): number {
    return this.decorations.length;
  }

  /** 整体替换（用于基因编码导入），id 重新确定性分配 */
  replaceAll(items: Array<{ type: DecorationType; x: number; y: number; scale: number }>): void {
    this.decorations = items.map(d => ({
      id: this.idCounter++,
      type: d.type,
      x: d.x,
      y: d.y,
      scale: d.scale
    }));
  }
}
