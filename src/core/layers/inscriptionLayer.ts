/**
 * 题字排版层：把题字文本排版为逐字 text 指令。
 * - 竖排：自上而下成列，列满向左续列（传统读法）；
 * - 横排：自左而右成行，行满向下续行；
 * - 锚点 position 为整块文字的中心（0-100），超出纸面自动收敛留白；
 * - 文本超过纸面容量时按容量截断（明确且逐次一致），逐字坐标收敛在纸面内；
 * - 空文本 → 空层（合法）。题字永远位于最上层，遮挡关系固定。
 */

import { deepFreeze, hashOps, type DrawOp, type LayerOutput } from '../displayList';
import { r3 } from '../rng';
import { type InscriptionConfig, type PaperSizePreset } from '../types';

const PADDING = 12;

function clampToPaper(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function verticalOps(chars: string[], cfg: InscriptionConfig, size: PaperSizePreset): DrawOp[] {
  const lineHeight = cfg.fontSize * 1.25;
  const colWidth = cfg.fontSize * 1.15;
  const colsPerPage = Math.max(1, Math.floor((size.height - PADDING * 2) / lineHeight));
  const maxCols = Math.max(1, Math.floor((size.width - PADDING * 2) / colWidth));
  const capacity = colsPerPage * maxCols;
  const visible = chars.slice(0, capacity); // 超容量截断：边界表现明确且稳定
  const columns: string[][] = [];
  for (let i = 0; i < visible.length; i += colsPerPage) {
    columns.push(visible.slice(i, i + colsPerPage));
  }
  const blockW = columns.length * colWidth;
  const blockH = Math.min(colsPerPage, visible.length) * lineHeight;
  const centerX = (cfg.position.x / 100) * size.width;
  const centerY = (cfg.position.y / 100) * size.height;
  // 首列在最右；整体以锚点居中，并收敛到纸面留白内
  const originX = Math.min(
    size.width - PADDING - blockW + colWidth / 2,
    Math.max(PADDING + colWidth / 2, centerX + blockW / 2 - colWidth / 2),
  );
  const topY = Math.min(size.height - PADDING - blockH, Math.max(PADDING, centerY - blockH / 2));

  const ops: DrawOp[] = [];
  columns.forEach((col, colIndex) => {
    col.forEach((ch, rowIndex) => {
      ops.push({
        kind: 'text',
        text: ch,
        x: r3(clampToPaper(originX - colIndex * colWidth, size.width)),
        y: r3(clampToPaper(topY + (rowIndex + 1) * lineHeight - cfg.fontSize * 0.28, size.height)),
        size: cfg.fontSize,
        color: cfg.color,
        align: 'center',
      });
    });
  });
  return ops;
}

function horizontalOps(chars: string[], cfg: InscriptionConfig, size: PaperSizePreset): DrawOp[] {
  const cellW = cfg.fontSize * 1.05;
  const lineHeight = cfg.fontSize * 1.4;
  const perRow = Math.max(1, Math.floor((size.width - PADDING * 2) / cellW));
  const maxRows = Math.max(1, Math.floor((size.height - PADDING * 2) / lineHeight));
  const visible = chars.slice(0, perRow * maxRows);
  const rows: string[][] = [];
  for (let i = 0; i < visible.length; i += perRow) {
    rows.push(visible.slice(i, i + perRow));
  }
  const blockW = Math.min(perRow, visible.length) * cellW;
  const blockH = rows.length * lineHeight;
  const centerX = (cfg.position.x / 100) * size.width;
  const centerY = (cfg.position.y / 100) * size.height;
  const leftX = Math.min(size.width - PADDING - blockW, Math.max(PADDING, centerX - blockW / 2));
  const topY = Math.min(size.height - PADDING - blockH, Math.max(PADDING, centerY - blockH / 2));

  const ops: DrawOp[] = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((ch, colIndex) => {
      ops.push({
        kind: 'text',
        text: ch,
        x: r3(clampToPaper(leftX + colIndex * cellW, size.width)),
        y: r3(clampToPaper(topY + (rowIndex + 1) * lineHeight - cfg.fontSize * 0.32, size.height)),
        size: cfg.fontSize,
        color: cfg.color,
      });
    });
  });
  return ops;
}

export function renderInscriptionLayer(
  size: PaperSizePreset,
  cfg: InscriptionConfig,
  key: string,
): LayerOutput {
  const chars = Array.from(cfg.text).filter((ch) => ch.trim().length > 0);
  const ops = chars.length === 0 ? [] : cfg.layout === 'horizontal'
    ? horizontalOps(chars, cfg, size)
    : verticalOps(chars, cfg, size);
  const frozen = deepFreeze(ops);
  return deepFreeze({ kind: 'inscription', key, ops: frozen, hash: hashOps(frozen) });
}
