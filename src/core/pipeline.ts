/**
 * 渲染管线：参数配置 → 分层渲染结果 → 导出产物 的唯一入口。
 *
 * 隔离性保证：
 * - 每层按"输入哈希键"独立缓存；某层参数变化只重算该层，其余层直接复用（引用不变）；
 * - 缓存以键索引而非只记最后一次，参数改回去会命中同一份结果（换尺寸/换纹样可来回切换）；
 * - 导出产物按 (配方哈希, 光源) 缓存为不可变快照，之后的参数变更不会改写已生成的产物。
 */

import { composePaper, composedHash, type ComposedLayers } from './compose';
import { deepFreeze, type DrawOp, type LayerOutput } from './displayList';
import { buildExportArtifact, type ExportArtifact } from './exporter';
import { renderBaseLayer } from './layers/baseLayer';
import { renderGoldFoilLayer } from './layers/goldFoilLayer';
import { renderInscriptionLayer } from './layers/inscriptionLayer';
import { renderPatternLayer, sortPatternLayers } from './layers/patternLayer';
import { getColor, getSize, layerKeys, normalizeRecipe, recipeHash } from './recipe';
import type { LightMode, PaperRecipe, PaperSizePreset } from './types';

export interface RenderResult {
  /** 归一化后的配方快照（冻结） */
  recipe: PaperRecipe;
  size: PaperSizePreset;
  layers: ComposedLayers;
  /** 纸面显示列表（光源无关），预览直接绘制它 */
  paperOps: DrawOp[];
  /** 纸面内容哈希：同参数任意次渲染完全一致 */
  hash: string;
}

export class PaperPipeline {
  private baseCache = new Map<string, LayerOutput>();
  private patternCache = new Map<string, LayerOutput>();
  private goldCache = new Map<string, LayerOutput>();
  private inscriptionCache = new Map<string, LayerOutput>();
  private exportCache = new Map<string, ExportArtifact>();
  private result: RenderResult | null = null;

  /** 更新参数并返回最新渲染结果；未受影响的层保持原引用 */
  update(input: Partial<PaperRecipe>): RenderResult {
    const recipe = normalizeRecipe(input);
    const size = getSize(recipe.sizeId);
    const color = getColor(recipe.baseColorId);
    const keys = layerKeys(recipe);

    const base = this.cached(this.baseCache, keys.base, () => renderBaseLayer(size, color, keys.base));

    const sortedConfigs = sortPatternLayers(recipe.patterns);
    const keyById = new Map(keys.patterns.map((p) => [p.id, p.key]));
    const patterns = sortedConfigs.map((cfg) => {
      const key = keyById.get(cfg.id)!;
      return this.cached(this.patternCache, key, () => renderPatternLayer(size, cfg, key));
    });

    const goldFoil = this.cached(this.goldCache, keys.goldFoil, () =>
      renderGoldFoilLayer(size, recipe.goldFoil.density, keys.goldFoil),
    );
    const inscription = this.cached(this.inscriptionCache, keys.inscription, () =>
      renderInscriptionLayer(size, recipe.inscription, keys.inscription),
    );

    const layers: ComposedLayers = { base, patterns, goldFoil, inscription };
    const paperOps = deepFreeze(composePaper(layers));
    this.result = deepFreeze({
      recipe,
      size,
      layers,
      paperOps,
      hash: composedHash(paperOps),
    });
    return this.result;
  }

  getResult(): RenderResult {
    if (!this.result) throw new Error('PaperPipeline: 尚未调用 update()');
    return this.result;
  }

  /**
   * 入匣导出：返回不可变的导出产物快照。
   * 同一 (配方, 光源) 反复导出返回同一实例；配方变更后旧产物保持原样。
   */
  export(lightMode: LightMode): ExportArtifact {
    const result = this.getResult();
    const cacheKey = `${recipeHash(result.recipe)}:${lightMode}`;
    const cached = this.exportCache.get(cacheKey);
    if (cached) return cached;
    const artifact = buildExportArtifact(result, lightMode);
    this.exportCache.set(cacheKey, artifact);
    return artifact;
  }

  private cached(cache: Map<string, LayerOutput>, key: string, render: () => LayerOutput): LayerOutput {
    const hit = cache.get(key);
    if (hit) return hit;
    const output = render();
    cache.set(key, output);
    return output;
  }
}
