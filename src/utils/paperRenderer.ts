/**
 * 对外渲染入口（保持 TECH 文档约定：renderPaper(canvas, recipe, lightMode)）。
 *
 * 内部已重构为"参数配置 / 分层渲染 / 题字排版 / 导出产物"分离的管线：
 * 该函数仅负责把 PaperPipeline 的纸面结果（含光源罩染）绘制到调用方提供的 canvas，
 * 调用方使用方式不变，同参数多次调用结果完全一致。
 */

import { composeWithLight } from '@/core/compose';
import { paintOps, type PaintContext } from '@/core/displayList';
import { PaperPipeline, type RenderResult } from '@/core/pipeline';
import type { LightMode, PaperRecipe } from '@/core/types';

// 模块级共享管线：层缓存跨调用复用，改一个参数只重算相关层
const sharedPipeline = new PaperPipeline();

export function renderPaper(
  canvas: HTMLCanvasElement,
  recipe: PaperRecipe,
  lightMode: LightMode = 'daylight',
): RenderResult {
  const result = sharedPipeline.update(recipe);
  const ops = composeWithLight(result.layers, result.size, lightMode);

  canvas.width = result.size.width;
  canvas.height = result.size.height;
  const ctx = canvas.getContext('2d');
  if (ctx) paintOps(ctx as unknown as PaintContext, ops);
  return result;
}

export { PaperPipeline };
export type { RenderResult } from '@/core/pipeline';
export type { ExportArtifact } from '@/core/exporter';
