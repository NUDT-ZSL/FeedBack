/**
 * 洒金层：密度决定金箔片数量（0 - 100），分布由 (尺寸, 密度) 的固定种子生成。
 *
 * 采用"抖动网格"而不是拒绝采样：
 * - 每片金箔落在独立网格单元内，天然不重叠，且任何密度下都必然终止（不卡死）；
 * - 同一份参数渲染/导出任意次，位置、大小、顶点完全一致。
 * 边界：密度 0 → 空层（合法、不报错、纸面仍有底色与其它层）。
 */

import { deepFreeze, hashOps, type DrawOp, type LayerOutput, type Point } from '../displayList';
import { r3, seededRandom } from '../rng';
import { type PaperSizePreset } from '../types';

const GOLD_EDGE = '#ffd700';
const GOLD_CORE = '#fff8dc';

export function renderGoldFoilLayer(size: PaperSizePreset, density: number, key: string): LayerOutput {
  const { width, height } = size;
  const count = Math.max(0, Math.min(100, Math.round(density)));
  const ops: DrawOp[] = [];

  if (count > 0) {
    const rng = seededRandom(`gold-particles:${size.id}:${count}`);
    const cols = Math.max(1, Math.ceil(Math.sqrt((count * width) / height)));
    const rows = Math.max(1, Math.ceil(count / cols));
    const cellW = width / cols;
    const cellH = height / rows;

    for (let i = 0; i < count; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const radius = 3 + rng() * 4;
      // 在单元内部留出半径余量抖动，保证箔片不越出纸面、不侵入相邻单元
      const cx = (col + 0.5) * cellW + (rng() - 0.5) * Math.max(0, cellW - radius * 2);
      const cy = (row + 0.5) * cellH + (rng() - 0.5) * Math.max(0, cellH - radius * 2);
      const rotation = rng() * Math.PI * 2;
      const sides = 3 + Math.floor(rng() * 5); // 3 - 7 边不规则多边形
      const points: Point[] = [];
      for (let v = 0; v < sides; v += 1) {
        const angle = rotation + (Math.PI * 2 * v) / sides;
        const rr = radius * (0.55 + rng() * 0.45);
        points.push({
          x: r3(Math.min(width, Math.max(0, cx + rr * Math.cos(angle)))),
          y: r3(Math.min(height, Math.max(0, cy + rr * Math.sin(angle)))),
        });
      }
      ops.push({
        kind: 'polygon',
        points,
        fill: GOLD_EDGE,
        gradient: { from: GOLD_CORE, to: GOLD_EDGE },
      });
    }
  }

  const frozen = deepFreeze(ops);
  return deepFreeze({ kind: 'goldFoil', key, ops: frozen, hash: hashOps(frozen) });
}
