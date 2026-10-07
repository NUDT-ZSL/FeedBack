/**
 * 洒金粒子生成：纯函数、确定性。
 * 同一份 (count, seed, size) 永远得到同一份粒子分布；
 * 非重叠检测有固定尝试上限，超出后落在最后候选点，保证片数稳定、不出现空白或错位。
 */

import type { GoldFoilParticle, PaperSize } from './types.ts';
import { hashString, mulberry32 } from './random.ts';

const MAX_PLACEMENT_ATTEMPTS = 24;
const MARGIN_RATIO = 0.04;

export function generateGoldFoilParticles(count: number, seed: number, size: PaperSize): GoldFoilParticle[] {
  const total = Math.max(0, Math.round(count));
  if (total === 0) return [];
  const rng = mulberry32((seed ^ hashString(`gold:${total}:${size.width}x${size.height}`)) >>> 0);
  const marginX = size.width * MARGIN_RATIO;
  const marginY = size.height * MARGIN_RATIO;
  const placed: GoldFoilParticle[] = [];

  for (let i = 0; i < total; i += 1) {
    let candidate: { x: number; y: number; radius: number } = { x: 0, y: 0, radius: 0 };
    for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt += 1) {
      const x = marginX + rng() * (size.width - marginX * 2);
      const y = marginY + rng() * (size.height - marginY * 2);
      const radius = 2.5 + rng() * 4.5;
      candidate = { x, y, radius };
      const overlaps = placed.some((p) => {
        const dx = p.x - x;
        const dy = p.y - y;
        return Math.hypot(dx, dy) < (p.size + radius) * 0.9;
      });
      if (!overlaps) break;
    }
    const rotation = rng() * Math.PI * 2;
    const vertexCount = 3 + Math.floor(rng() * 5); // 3-7 个顶点的不规则多边形
    const points: { x: number; y: number }[] = [];
    for (let v = 0; v < vertexCount; v += 1) {
      const angle = (v / vertexCount) * Math.PI * 2;
      const r = candidate.radius * (0.6 + rng() * 0.4);
      points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    placed.push({ x: candidate.x, y: candidate.y, size: candidate.radius, rotation, points });
  }
  return placed;
}
