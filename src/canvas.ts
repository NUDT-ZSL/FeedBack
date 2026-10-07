import type { StampRecord } from './types.ts';

export const CANVAS_WIDTH = 480;
export const CANVAS_HEIGHT = 480;
export const INK_COLOR = '#8b1a1a';

const SLOT_COLUMNS = 3;
const SLOT_ROWS = 3;

export function slotPosition(index: number): { x: number; y: number } {
  const col = index % SLOT_COLUMNS;
  const row = Math.floor(index / SLOT_COLUMNS) % SLOT_ROWS;
  const cellW = CANVAS_WIDTH / SLOT_COLUMNS;
  const cellH = CANVAS_HEIGHT / SLOT_ROWS;
  return {
    x: Math.round(col * cellW + cellW / 2),
    y: Math.round(row * cellH + cellH / 2),
  };
}

export class CanvasModel {
  private marks: StampRecord[] = [];

  stamp(record: StampRecord): void {
    this.marks.push({ ...record });
  }

  clear(): void {
    this.marks = [];
  }

  getRecords(): StampRecord[] {
    return this.marks.map((m) => ({ ...m }));
  }

  count(): number {
    return this.marks.length;
  }

  exportSvg(): string {
    return renderSvg(this.marks);
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderSvg(records: StampRecord[]): string {
  const seals = records
    .map((r) => {
      const half = r.sizeMm / 2;
      return [
        `<g transform="translate(${r.x},${r.y}) rotate(${r.rotation})">`,
        `<rect x="${-half}" y="${-half}" width="${r.sizeMm}" height="${r.sizeMm}" fill="none" stroke="${INK_COLOR}" stroke-width="2"/>`,
        `<text x="0" y="0" font-size="${Math.round(r.sizeMm / 2)}" fill="${INK_COLOR}" text-anchor="middle" dominant-baseline="central" data-font="${r.fontId}">${escapeXml(r.text)}</text>`,
        `</g>`,
      ].join('');
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" ` +
    `viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}">` +
    `<rect width="100%" height="100%" fill="#f5deb3"/>` +
    seals +
    `</svg>`
  );
}
