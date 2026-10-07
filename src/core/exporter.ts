/**
 * 导出产物层：把当前渲染结果装入 600x800 木匣，生成不可变快照。
 *
 * - 木匣内的笺纸与页面预览是同一份分层显示列表（仅加缩放位移与同一数值的光源罩染）；
 * - ExportArtifact 一旦生成即冻结：后续改参数不会影响已入匣的产物；
 * - 全部为纯数据指令 + 内容哈希，离线环境可直接验证，浏览器中由 paintOps 转 PNG。
 */

import { composeWithLight, lightTintOp } from './compose';
import { deepFreeze, hashOps, type DrawOp } from './displayList';
import { seededRandom, r3 } from './rng';
import type { RenderResult } from './pipeline';
import {
  GOLD_DENSITY_PRESETS,
  LIGHT_NAMES,
  PATTERN_TYPES,
  type LightMode,
  type PaperRecipe,
} from './types';
import { getColor, getSize } from './recipe';

export const EXPORT_WIDTH = 600;
export const EXPORT_HEIGHT = 800;
const MARGIN = 56;
const BOX_COLOR = '#5c3a21';
const BOX_LINE = '#4a2e1a';
const GOLD_LINE = '#d4af37';
const BRONZE = '#b8860b';

export interface ExportArtifact {
  /** 内容标识：同配方同光源永远相同 */
  id: string;
  width: number;
  height: number;
  lightMode: LightMode;
  ops: readonly DrawOp[];
  hash: string;
  shareText: string;
  /** 入匣时刻的配方快照（冻结） */
  recipe: PaperRecipe;
}

function woodGrain(): DrawOp[] {
  const rng = seededRandom('export:woodgrain:v1');
  const ops: DrawOp[] = [];
  for (let i = 0; i < 26; i += 1) {
    const y = r3(rng() * EXPORT_HEIGHT);
    ops.push({
      kind: 'line',
      x1: 0,
      y1: y,
      x2: EXPORT_WIDTH,
      y2: r3(y + (rng() - 0.5) * 14),
      stroke: BOX_LINE,
      lineWidth: 1,
      alpha: 0.18,
    });
  }
  return ops;
}

function cornerClasps(frameX: number, frameY: number, frameW: number, frameH: number): DrawOp[] {
  const inset = 14;
  const corners: [number, number][] = [
    [frameX + inset, frameY + inset],
    [frameX + frameW - inset, frameY + inset],
    [frameX + inset, frameY + frameH - inset],
    [frameX + frameW - inset, frameY + frameH - inset],
  ];
  return corners.flatMap(([cx, cy]) => [
    { kind: 'ellipse' as const, cx, cy, rx: 9, ry: 9, fill: BRONZE },
    { kind: 'ellipse' as const, cx: cx - 2, cy: cy - 2, rx: 4, ry: 4, fill: '#e6c15f' },
  ]);
}

/** 构造入匣导出产物（纯函数） */
export function buildExportArtifact(result: RenderResult, lightMode: LightMode): ExportArtifact {
  const { size } = result;
  const scale = Math.min(
    (EXPORT_WIDTH - MARGIN * 2) / size.width,
    (EXPORT_HEIGHT - MARGIN * 2) / size.height,
  );
  const paperW = size.width * scale;
  const paperH = size.height * scale;
  const dx = (EXPORT_WIDTH - paperW) / 2;
  const dy = (EXPORT_HEIGHT - paperH) / 2;

  const paperOps = composeWithLight(result.layers, size, lightMode);
  const ops: DrawOp[] = [
    { kind: 'rect', x: 0, y: 0, w: EXPORT_WIDTH, h: EXPORT_HEIGHT, fill: BOX_COLOR },
    ...woodGrain(),
    // 木匣内框金线
    { kind: 'rect', x: MARGIN / 2, y: MARGIN / 2, w: EXPORT_WIDTH - MARGIN, h: EXPORT_HEIGHT - MARGIN, stroke: GOLD_LINE, lineWidth: 2 },
    // 装入的笺纸：与预览同一指令序列，仅缩放/位移
    { kind: 'group', transform: { dx, dy, scale }, ops: paperOps },
    ...cornerClasps(MARGIN / 2, MARGIN / 2, EXPORT_WIDTH - MARGIN, EXPORT_HEIGHT - MARGIN),
  ];

  const frozenOps = deepFreeze(ops);
  const recipe = deepFreeze(result.recipe);
  return deepFreeze({
    id: `${hashOps(frozenOps)}:${lightMode}`,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    lightMode,
    ops: frozenOps,
    hash: hashOps(frozenOps),
    shareText: buildShareText(result.recipe, lightMode),
    recipe,
  });
}

export function densityLabel(density: number): string {
  const preset = GOLD_DENSITY_PRESETS.find((p) => p.value === density);
  if (density === 0) return '无洒金';
  return preset ? `${preset.name}（${density}片）` : `自定义（${density}片）`;
}

/** 分享文案：完整描述配方参数 */
export function buildShareText(recipe: PaperRecipe, lightMode: LightMode): string {
  const size = getSize(recipe.sizeId);
  const color = getColor(recipe.baseColorId);
  const patternNames = [...recipe.patterns]
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => PATTERN_TYPES.find((t) => t.id === p.type)?.name ?? p.type)
    .join('、');
  const inscription = recipe.inscription.text.trim()
    ? `，题字「${recipe.inscription.text.trim()}」`
    : '';
  return [
    `【古风笺纸工坊】${size.name}（${size.width}×${size.height}）`,
    `${color.name}宣纸，纹样：${patternNames || '无'}，洒金：${densityLabel(recipe.goldFoil.density)}${inscription}`,
    `${LIGHT_NAMES[lightMode]}下入匣成样。`,
  ].join('，');
}

/** 导出产物中的笺纸指令（含光源罩染），供一致性校验使用 */
export function exportPaperOps(result: RenderResult, lightMode: LightMode): DrawOp[] {
  return composeWithLight(result.layers, result.size, lightMode);
}

export { lightTintOp };
