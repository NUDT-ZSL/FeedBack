/**
 * 合成层：把各层渲染结果按固定层叠关系拼成纸面显示列表。
 * 层叠关系（自下而上）：底色 → 纹样（按 order/id 升序）→ 洒金 → 题字 → 光源罩染。
 * 该顺序是唯一事实来源，预览与导出共用，遮挡关系稳定可预期。
 */

import { hashOps, type DrawOp, type LayerOutput } from './displayList';
import { LIGHT_TINTS, type LightMode, type PaperSizePreset } from './types';

export interface ComposedLayers {
  base: LayerOutput;
  patterns: LayerOutput[]; // 已按层叠顺序升序排列
  goldFoil: LayerOutput;
  inscription: LayerOutput;
}

/** 纸面指令（不含光源罩染）：光源无关，切换日光/烛光不会使任何一层失效 */
export function composePaper(layers: ComposedLayers): DrawOp[] {
  return [
    ...layers.base.ops,
    ...layers.patterns.flatMap((p) => p.ops),
    ...layers.goldFoil.ops,
    ...layers.inscription.ops,
  ];
}

/** 光源罩染指令：与预览 DOM 罩层使用完全相同的颜色数值 */
export function lightTintOp(size: PaperSizePreset, lightMode: LightMode): DrawOp {
  return { kind: 'rect', x: 0, y: 0, w: size.width, h: size.height, fill: LIGHT_TINTS[lightMode] };
}

/** 纸面 + 光源罩染（导出与 renderPaper 兼容入口使用） */
export function composeWithLight(
  layers: ComposedLayers,
  size: PaperSizePreset,
  lightMode: LightMode,
): DrawOp[] {
  return [...composePaper(layers), lightTintOp(size, lightMode)];
}

export function composedHash(ops: readonly DrawOp[]): string {
  return hashOps(ops);
}
