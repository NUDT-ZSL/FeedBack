import type { Position, SealState, StrokeData } from '../types/index.ts';
import { SEAL_SIZES } from '../types/index.ts';

export const STONE_COLOR = '#b8a07a';
export const STONE_DARK = '#8f7757';
export const PAPER_COLOR = '#fcf6e6';
export const CINNABAR = 'rgba(204,51,51,0.8)';
export const YINKE_STROKE = '#a68f68';
export const YANGKE_STROKE = '#ffffff';

export const EXPORT_SIZE = 480;
export const EXPORT_SEAL_SIZE = 400;

export const canvasSizeFor = (state: SealState): number => {
  const config = SEAL_SIZES.find((item) => item.value === state.size);
  return config ? config.canvasSize : SEAL_SIZES[0].canvasSize;
};

export const strokeTransform = (stroke: StrokeData, canvasSize: number): string => {
  const box = canvasSize * 0.5;
  const scale = box / 100;
  const x = stroke.originalPosition.x * canvasSize - box / 2 + stroke.position.x + stroke.tempOffset.x;
  const y = stroke.originalPosition.y * canvasSize - box / 2 + stroke.position.y + stroke.tempOffset.y;
  return `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})`;
};

export const strokeCenter = (stroke: StrokeData, canvasSize: number): Position => ({
  x: stroke.originalPosition.x * canvasSize + stroke.position.x + stroke.tempOffset.x,
  y: stroke.originalPosition.y * canvasSize + stroke.position.y + stroke.tempOffset.y,
});

export const mulberry32 = (seed: number): (() => number) => {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface PaperFiber {
  x: number;
  y: number;
  length: number;
  angle: number;
  opacity: number;
}

export const paperFibers = (width: number, height: number, seed = 7): PaperFiber[] => {
  const random = mulberry32(seed);
  const count = Math.max(24, Math.floor((width * height) / 3200));
  const fibers: PaperFiber[] = [];
  for (let index = 0; index < count; index += 1) {
    fibers.push({
      x: random() * width,
      y: random() * height,
      length: 4 + random() * 14,
      angle: random() * Math.PI,
      opacity: 0.04 + random() * 0.06,
    });
  }
  return fibers;
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const strokeElements = (state: SealState, canvasSize: number, fill: string): string =>
  state.strokes
    .map(
      (stroke) =>
        `<path data-char="${escapeXml(stroke.char)}" d="${stroke.path}" fill="${fill}" transform="${strokeTransform(stroke, canvasSize)}"/>`,
    )
    .join('');

export const buildDesignSvg = (state: SealState): string => {
  const size = canvasSizeFor(state);
  const strokeFill = state.style === 'yinke' ? YINKE_STROKE : YANGKE_STROKE;
  const bgFill = state.style === 'yinke' ? STONE_COLOR : STONE_DARK;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" data-style="${state.style}" data-font="${state.font}" data-size="${state.size}">`,
    `<rect x="0" y="0" width="${size}" height="${size}" rx="10" fill="${bgFill}"/>`,
    `<rect x="6" y="6" width="${size - 12}" height="${size - 12}" rx="8" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="2"/>`,
    strokeElements(state, size, strokeFill),
    `</svg>`,
  ].join('');
};

export const buildStampSvg = (state: SealState, sealSize: number): string => {
  const border = Math.max(6, Math.round(sealSize * 0.035));
  const inner = sealSize - border * 2;
  const strokes = state.strokes
    .map((stroke) => {
      const box = inner * 0.5;
      const scale = box / 100;
      const x = border + stroke.originalPosition.x * inner - box / 2 + stroke.position.x;
      const y = border + stroke.originalPosition.y * inner - box / 2 + stroke.position.y;
      return `<path data-char="${escapeXml(stroke.char)}" d="${stroke.path}" fill="${CINNABAR}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})"/>`;
    })
    .join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sealSize}" height="${sealSize}" viewBox="0 0 ${sealSize} ${sealSize}" data-style="${state.style}" data-font="${state.font}">`,
    `<rect x="${border / 2}" y="${border / 2}" width="${sealSize - border}" height="${sealSize - border}" rx="8" fill="none" stroke="${CINNABAR}" stroke-width="${border}"/>`,
    strokes,
    `</svg>`,
  ].join('');
};

export const buildExportSvg = (state: SealState): string => {
  const margin = (EXPORT_SIZE - EXPORT_SEAL_SIZE) / 2;
  const fibers = paperFibers(EXPORT_SIZE, EXPORT_SIZE)
    .map((fiber) => {
      const x2 = fiber.x + Math.cos(fiber.angle) * fiber.length;
      const y2 = fiber.y + Math.sin(fiber.angle) * fiber.length;
      return `<line x1="${fiber.x.toFixed(1)}" y1="${fiber.y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#b9a06b" stroke-opacity="${fiber.opacity.toFixed(3)}" stroke-width="1"/>`;
    })
    .join('');
  const stamp = buildStampSvg(state, EXPORT_SEAL_SIZE)
    .replace(/^<svg /, `<svg x="${margin}" y="${margin}" `);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${EXPORT_SIZE}" height="${EXPORT_SIZE}" viewBox="0 0 ${EXPORT_SIZE} ${EXPORT_SIZE}">`,
    `<rect x="0" y="0" width="${EXPORT_SIZE}" height="${EXPORT_SIZE}" fill="${PAPER_COLOR}"/>`,
    fibers,
    stamp,
    `</svg>`,
  ].join('');
};

export const svgToDataUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export interface PaperDrawingContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  lineWidth: number;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

export const drawPaperBackground = (
  ctx: PaperDrawingContext,
  width: number,
  height: number,
): void => {
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#b9a06b';
  ctx.lineWidth = 1;
  for (const fiber of paperFibers(width, height)) {
    ctx.globalAlpha = fiber.opacity;
    ctx.beginPath();
    ctx.moveTo(fiber.x, fiber.y);
    ctx.lineTo(fiber.x + Math.cos(fiber.angle) * fiber.length, fiber.y + Math.sin(fiber.angle) * fiber.length);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
};

export interface PngExportDeps {
  createCanvas(width: number, height: number): HTMLCanvasElement;
  loadImage(src: string): Promise<HTMLImageElement>;
}

export const exportSealPng = async (
  state: SealState,
  deps: PngExportDeps,
): Promise<string> => {
  const canvas = deps.createCanvas(EXPORT_SIZE, EXPORT_SIZE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建导出画布');
  drawPaperBackground(ctx, EXPORT_SIZE, EXPORT_SIZE);
  const image = await deps.loadImage(svgToDataUrl(buildStampSvg(state, EXPORT_SEAL_SIZE)));
  const margin = (EXPORT_SIZE - EXPORT_SEAL_SIZE) / 2;
  ctx.drawImage(image, margin, margin, EXPORT_SEAL_SIZE, EXPORT_SEAL_SIZE);
  return canvas.toDataURL('image/png');
};

export const browserPngDeps = (): PngExportDeps => ({
  createCanvas: (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  loadImage: (src) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('印章图像加载失败'));
      image.src = src;
    }),
});
