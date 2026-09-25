import { createRenderPlan, paramsHash } from './artEngine';
import { hashObject } from './hash';
import type { ArtConfig, CanvasSpec, DrawOp, HistoryItem, RenderPlan } from './types';

export interface ExportArtifact {
  format: 'svg';
  meta: {
    prompt: string;
    seed: number;
    /** 导出时刻的参数深拷贝快照，之后的任何修改都不会渗入。 */
    params: ArtConfig;
    canvas: CanvasSpec;
    paramsHash: string;
  };
  svg: string;
  contentHash: string;
}

function opToSvg(op: DrawOp, plan: RenderPlan): string {
  const w = plan.meta.pixelWidth;
  const h = plan.meta.pixelHeight;
  const base = Math.min(w, h);
  const cx = op.x * w;
  const cy = op.y * h;
  const size = op.size * base;
  const common = `fill="${op.color}" opacity="${op.opacity}" stroke="${op.color}" stroke-width="${op.strokeWidth * plan.meta.canvas.dpr}"`;
  switch (op.shape) {
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${size / 2}" ${common}/>`;
    case 'rectangle':
      return `<rect x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" transform="rotate(${op.rotation} ${cx} ${cy})" ${common}/>`;
    case 'triangle': {
      const r = size / 2;
      const points = [0, 1, 2]
        .map((k) => {
          const angle = ((op.rotation + k * 120) * Math.PI) / 180;
          return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
        })
        .join(' ');
      return `<polygon points="${points}" ${common}/>`;
    }
    case 'wave': {
      const y = cy;
      return `<path d="M ${cx - size / 2} ${y} Q ${cx - size / 4} ${y - size / 2} ${cx} ${y} T ${cx + size / 2} ${y}" fill="none" stroke="${op.color}" stroke-width="${op.strokeWidth * plan.meta.canvas.dpr}" opacity="${op.opacity}"/>`;
    }
  }
}

/** 由渲染计划生成确定性 SVG：同一计划永远得到同一字符串。 */
export function planToSvg(plan: RenderPlan): string {
  const { pixelWidth, pixelHeight } = plan.meta;
  const defs =
    `<defs><linearGradient id="bg" gradientTransform="rotate(${plan.background.angle})">` +
    `<stop offset="0%" stop-color="${plan.background.from}"/>` +
    `<stop offset="100%" stop-color="${plan.background.to}"/>` +
    `</linearGradient></defs>`;
  const body = [...plan.ops]
    .sort((a, b) => a.layer - b.layer)
    .map((op) => opToSvg(op, plan))
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" ` +
    `viewBox="0 0 ${pixelWidth} ${pixelHeight}">` +
    `${defs}<rect width="${pixelWidth}" height="${pixelHeight}" fill="url(#bg)"/>${body}</svg>`
  );
}

/**
 * 导出历史项。导出与预览使用同一条路径（createRenderPlan），
 * 因此导出产物永远反映记录中的参数快照，而不是任何中间状态。
 */
export function exportArt(item: HistoryItem): ExportArtifact {
  const plan = createRenderPlan(item.config, item.canvas);
  const svg = planToSvg(plan);
  const snapshot: ArtConfig = JSON.parse(JSON.stringify(item.config)) as ArtConfig;
  return {
    format: 'svg',
    meta: {
      prompt: item.prompt,
      seed: snapshot.seed,
      params: snapshot,
      canvas: { ...item.canvas },
      paramsHash: paramsHash(item.config),
    },
    svg,
    contentHash: hashObject({ svg, paramsHash: paramsHash(item.config), canvas: item.canvas }),
  };
}
