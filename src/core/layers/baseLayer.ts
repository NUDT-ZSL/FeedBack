/**
 * 底色层：宣纸底色 + 手工纤维纹理。
 * 输入仅依赖 (尺寸, 底色)，与纹样/洒金/题字完全解耦。
 */

import { deepFreeze, hashOps, type DrawOp, type LayerOutput } from '../displayList';
import { r3, seededRandom } from '../rng';
import type { PaperColorPreset, PaperSizePreset } from '../types';

function shade(hex: string, delta: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  const r = clamp((n >> 16) + delta);
  const g = clamp(((n >> 8) & 0xff) + delta);
  const b = clamp((n & 0xff) + delta);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function renderBaseLayer(size: PaperSizePreset, color: PaperColorPreset, key: string): LayerOutput {
  const { width, height } = size;
  const ops: DrawOp[] = [{ kind: 'rect', x: 0, y: 0, w: width, h: height, fill: color.hex }];

  // 细密纤维纹路：透明度 10%-20%，数量随纸面面积，种子确定
  const rng = seededRandom(`base-fiber:${size.id}:${color.id}`);
  const fiberCount = Math.round((width * height) / 900);
  const darker = shade(color.hex, -26);
  const lighter = shade(color.hex, 18);
  for (let i = 0; i < fiberCount; i += 1) {
    const x = rng() * width;
    const y = rng() * height;
    const len = 6 + rng() * 18;
    const angle = rng() * Math.PI;
    ops.push({
      kind: 'line',
      x1: r3(x),
      y1: r3(y),
      x2: r3(x + len * Math.cos(angle)),
      y2: r3(y + len * Math.sin(angle)),
      stroke: rng() > 0.5 ? darker : lighter,
      lineWidth: 0.6,
      alpha: r3(0.1 + rng() * 0.1),
    });
  }

  const frozen = deepFreeze(ops);
  return deepFreeze({ kind: 'base', key, ops: frozen, hash: hashOps(frozen) });
}
