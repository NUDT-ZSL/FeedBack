/**
 * 兼容层：保持原有对外调用方式 renderPaper(canvas, recipe, lightMode) 不变。
 * 内部改为分层缓存引擎；同一 canvas 的引擎实例被复用，参数变化只会重绘相关层。
 */

import { PaperEngine, type RenderResult } from '../core/engine.ts';
import type { LightMode, PaperRecipe } from '../core/types.ts';
import { canvasSurfaceFactory, surfaceFromCanvas } from './canvasSurface.ts';

const engines = new WeakMap<HTMLCanvasElement, PaperEngine>();

export function renderPaper(
  canvas: HTMLCanvasElement,
  recipe: PaperRecipe,
  lightMode: LightMode = 'daylight',
): RenderResult {
  let engine = engines.get(canvas);
  if (!engine) {
    engine = new PaperEngine(recipe, canvasSurfaceFactory);
    engines.set(canvas, engine);
  }
  engine.setRecipe(recipe);
  const result = engine.render(lightMode);
  canvas.width = recipe.size.width;
  canvas.height = recipe.size.height;
  const viewport = surfaceFromCanvas(canvas);
  viewport.getContext().drawImage(result.surface, 0, 0);
  return result;
}

export function getPaperEngine(canvas: HTMLCanvasElement): PaperEngine | undefined {
  return engines.get(canvas);
}

export { PaperEngine };
