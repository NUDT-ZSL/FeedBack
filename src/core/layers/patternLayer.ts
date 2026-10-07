/**
 * 纹样层：每层纹样独立渲染、独立缓存。
 * 层叠顺序（order 相同按 id 字典序）在 compose 阶段统一排序，保证稳定可预期。
 */

import { deepFreeze, hashOps, type DrawOp, type LayerOutput } from '../displayList';
import { r3 } from '../rng';
import type { PaperSizePreset, PatternLayerConfig } from '../types';
import { buildPatternArt } from './patternArt';

/** 纹样层叠排序：order 大者在上；order 相同按 id 字典序，杜绝并列时顺序漂移 */
export function sortPatternLayers<T extends { order: number; id: string }>(layers: readonly T[]): T[] {
  return [...layers].sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function renderPatternLayer(
  size: PaperSizePreset,
  config: PatternLayerConfig,
  key: string,
): LayerOutput {
  const art = buildPatternArt(config.type);
  const cx = r3((config.position.x / 100) * size.width);
  const cy = r3((config.position.y / 100) * size.height);
  const scale = r3(config.scale);

  // 图元统一包一层 group（定位/缩放/旋转），整体不透明度由 group 承载；
  // 外层 clip 到纸面，保证贴边纹样不会错位溢出。
  const grouped: DrawOp = {
    kind: 'group',
    transform: { dx: cx, dy: cy, scale, rotateDeg: config.rotation },
    ops: art.slice(),
    alpha: r3(config.opacity),
  };
  const ops: DrawOp[] = [
    { kind: 'clip', x: 0, y: 0, w: size.width, h: size.height, ops: [grouped] },
  ];

  const frozen = deepFreeze(ops);
  return deepFreeze({ kind: 'pattern', key, ops: frozen, hash: hashOps(frozen) });
}
