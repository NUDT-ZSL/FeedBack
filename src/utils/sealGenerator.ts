import type { Position, SealDocument, SealSnapshot } from '../types/index.ts';
import { SEAL_POSITIONS, SEAL_SIZES } from '../types/index.ts';
import { generateSealPath } from './zhuanshuPaths.ts';

export const STONE_COLOR = '#b8a07a';
export const CINNABAR = '#b5342a';
export const CINNABAR_DARK = '#8f241c';
export const PAPER_COLOR = '#f4ecd8';

export interface GlyphBox {
  char: string;
  index: number;
  cx: number;
  cy: number;
  box: number;
  path: string;
}

export function canvasSizeOf(seal: Pick<SealSnapshot, 'size'>): number {
  return SEAL_SIZES.find((s) => s.value === seal.size)?.canvasSize ?? 200;
}

export function offsetOf(seal: Pick<SealSnapshot, 'strokeOffsets'>, index: number): Position {
  return seal.strokeOffsets[index] ?? { x: 0, y: 0 };
}

/** 计算每个字在印面上的实际布局（含笔画偏移），画布与导出共用同一份结果 */
export function layoutGlyphs(seal: Pick<SealSnapshot, 'text' | 'font' | 'size' | 'strokeOffsets'>): GlyphBox[] {
  const size = canvasSizeOf(seal);
  const chars = Array.from(seal.text);
  const box = size / 2;
  return chars.map((char, index) => {
    const anchor = SEAL_POSITIONS[index] ?? { x: 0.5, y: 0.5 };
    const offset = offsetOf(seal, index);
    return {
      char,
      index,
      cx: anchor.x * size + offset.x,
      cy: anchor.y * size + offset.y,
      box,
      path: generateSealPath(char, seal.font),
    };
  });
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface SealSvgOptions {
  /** stamp: 印泥钤盖效果（导出用）；stone: 印石设计稿 */
  mode: 'stone' | 'stamp';
}

/**
 * 生成某一方印的 SVG 字符串。纯函数：只依赖传入的 seal，
 * 切换印章或修改参数后重新调用即得到最新结果，不存在状态残留。
 */
export function generateSealSVG(seal: SealDocument | SealSnapshot, options: SealSvgOptions): string {
  const size = canvasSizeOf(seal);
  const glyphs = layoutGlyphs(seal);
  const { mode } = options;

  const bg = mode === 'stamp' ? (seal.style === 'yinke' ? CINNABAR : 'none') : STONE_COLOR;
  const ink = mode === 'stamp' ? (seal.style === 'yinke' ? '#ffffff' : CINNABAR) : seal.style === 'yinke' ? '#6f5b3e' : '#fff7e8';

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" data-seal-id="${'id' in seal ? escapeXml(seal.id) : ''}">`,
  );
  if (bg !== 'none') {
    parts.push(`<rect x="0" y="0" width="${size}" height="${size}" fill="${bg}" rx="${size * 0.04}"/>`);
  }
  if (mode === 'stamp') {
    const stroke = seal.style === 'yangke' ? CINNABAR : CINNABAR_DARK;
    const inset = size * 0.03;
    parts.push(
      `<rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" fill="none" stroke="${stroke}" stroke-width="${size * 0.02}" rx="${size * 0.03}"/>`,
    );
  }
  for (const glyph of glyphs) {
    const scale = glyph.box / 100;
    const x = glyph.cx - glyph.box / 2;
    const y = glyph.cy - glyph.box / 2;
    parts.push(
      `<g transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${scale.toFixed(4)})">` +
        `<path d="${glyph.path}" fill="${ink}" data-char="${escapeXml(glyph.char)}" data-index="${glyph.index}"/>` +
        `</g>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

/* ---------- 浏览器端：canvas 渲染与 PNG 导出 ---------- */

function drawGlyphToContext(ctx: CanvasRenderingContext2D, glyph: GlyphBox, fill: string): void {
  ctx.save();
  ctx.translate(glyph.cx - glyph.box / 2, glyph.cy - glyph.box / 2);
  ctx.scale(glyph.box / 100, glyph.box / 100);
  ctx.fillStyle = fill;
  ctx.fill(new Path2D(glyph.path));
  ctx.restore();
}

/** 把当前印章绘制到指定 canvas（盖印预览用，先清空再画，避免旧图像残留） */
export function renderSealToCanvas(seal: SealDocument | SealSnapshot, canvas: HTMLCanvasElement): void {
  const size = canvasSizeOf(seal);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  if (seal.style === 'yinke') {
    ctx.fillStyle = CINNABAR;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.strokeStyle = seal.style === 'yangke' ? CINNABAR : CINNABAR_DARK;
  ctx.lineWidth = size * 0.02;
  const inset = size * 0.03;
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);

  const ink = seal.style === 'yinke' ? '#ffffff' : CINNABAR;
  for (const glyph of layoutGlyphs(seal)) {
    drawGlyphToContext(ctx, glyph, ink);
  }
}

/** 导出当前选中印章为 PNG dataURL（只作用于传入的这一方） */
export function exportSealPNG(seal: SealDocument | SealSnapshot): string {
  const canvas = document.createElement('canvas');
  renderSealToCanvas(seal, canvas);
  return canvas.toDataURL('image/png');
}

export function downloadSealPNG(seal: SealDocument): void {
  const url = exportSealPNG(seal);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${seal.name || 'seal'}.png`;
  a.click();
}
