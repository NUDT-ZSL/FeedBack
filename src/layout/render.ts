import type { Block, Constraint, Placement } from "./types.ts";

export interface Bounds {
  width: number;
  height: number;
}

export function layoutBounds(
  blocks: Block[],
  placements: ReadonlyMap<string, Placement>,
  margin = 10,
): Bounds {
  let width = 0;
  let height = 0;
  for (const b of blocks) {
    const p = placements.get(b.id);
    if (!p) continue;
    width = Math.max(width, p.x + p.width);
    height = Math.max(height, p.y + p.height);
  }
  return { width: width + margin * 2, height: height + margin * 2 };
}

const PALETTE = ["#4a90d9", "#7b61ff", "#d96666", "#43a685", "#d99a3d", "#9a6fb0"];

export function renderSvg(
  blocks: Block[],
  constraints: Constraint[],
  placements: ReadonlyMap<string, Placement>,
): string {
  const bounds = layoutBounds(blocks, placements);
  const margin = 10;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">`,
  ];
  blocks.forEach((b, i) => {
    const p = placements.get(b.id);
    if (!p) return;
    const fill = PALETTE[i % PALETTE.length];
    parts.push(
      `<g><rect x="${p.x + margin}" y="${p.y + margin}" width="${p.width}" height="${p.height}" fill="${fill}" fill-opacity="0.35" stroke="${fill}" stroke-width="1.5"/><text x="${p.x + margin + 4}" y="${p.y + margin + 16}" font-family="monospace" font-size="12" fill="#222">${b.id}${p.orientation === "rotated" ? " R" : ""}</text></g>`,
    );
  });
  parts.push("</svg>");
  return parts.join("");
}

export interface ExportDocument {
  version: 1;
  generatedAt: string;
  blocks: Block[];
  constraints: Constraint[];
  placements: Placement[];
}

export function exportLayout(
  blocks: Block[],
  constraints: Constraint[],
  placements: ReadonlyMap<string, Placement>,
  now: Date = new Date(),
): ExportDocument {
  return {
    version: 1,
    generatedAt: now.toISOString(),
    blocks: blocks.map((b) => ({ ...b, xRange: { ...b.xRange }, yRange: { ...b.yRange } })),
    constraints: constraints.map((c) => ({ ...c })),
    placements: [...placements.values()],
  };
}

export function exportLayoutJson(
  blocks: Block[],
  constraints: Constraint[],
  placements: ReadonlyMap<string, Placement>,
): string {
  return JSON.stringify(exportLayout(blocks, constraints, placements), null, 2);
}
