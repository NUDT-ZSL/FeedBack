/**
 * 笺纸渲染引擎（对外核心 API）：
 * - 持有归一化配方与按层缓存；setRecipe/updateRecipe 只令指纹变化的层失效；
 * - 已生成的导出产物是不可变快照，后续调参不会改动它们；
 * - 所有产物以内容指纹命名，同参数多次渲染/导出逐字节一致。
 */

import type { ExportArtifact } from './exporter.ts';
import { renderExportArtifact } from './exporter.ts';
import {
  applyLightOverlay,
  composeLayers,
  createLayerSurface,
} from './renderer.ts';
import {
  cloneRecipe,
  layerFingerprint,
  layerFingerprints,
  normalizeRecipe,
  recipeFingerprint,
} from './recipe.ts';
import type { Surface, SurfaceFactory } from './surface.ts';
import type { LayerId, LightMode, PaperRecipe } from './types.ts';
import { LAYER_IDS } from './types.ts';
import { hashHex } from './random.ts';

interface CachedLayer {
  fingerprint: string;
  surface: Surface;
}

export interface RenderResult {
  surface: Surface;
  lightMode: LightMode;
  fingerprints: Record<LayerId, string>;
  /** 本次合成实际重绘的层（缓存未命中） */
  renderedLayers: LayerId[];
  /** 本次合成直接复用缓存的层 */
  reusedLayers: LayerId[];
  compositeKey: string;
}

export class PaperEngine {
  private recipe: PaperRecipe;
  private readonly surfaceFactory: SurfaceFactory;
  private readonly layerCache = new Map<LayerId, CachedLayer>();
  private compositeCache: { key: string; surface: Surface } | null = null;
  private readonly exportCache = new Map<string, ExportArtifact>();
  /** 已生成的导出产物（不可变快照，调参不会影响其中任何一个） */
  readonly artifacts: ExportArtifact[] = [];

  constructor(recipe: PaperRecipe, surfaceFactory: SurfaceFactory) {
    this.recipe = normalizeRecipe(recipe);
    this.surfaceFactory = surfaceFactory;
  }

  getRecipe(): PaperRecipe {
    return cloneRecipe(this.recipe);
  }

  /** 整体替换配方，返回真正失效（需要重绘）的层 */
  setRecipe(recipe: PaperRecipe): { invalidated: LayerId[] } {
    return this.applyRecipe(normalizeRecipe(recipe));
  }

  /** 局部更新配方 */
  updateRecipe(patch: Partial<PaperRecipe>): { invalidated: LayerId[] } {
    return this.applyRecipe(normalizeRecipe({ ...this.recipe, ...patch }));
  }

  private applyRecipe(next: PaperRecipe): { invalidated: LayerId[] } {
    const invalidated = LAYER_IDS.filter(
      (layer) => layerFingerprint(next, layer) !== layerFingerprint(this.recipe, layer),
    );
    if (invalidated.length === 0 && recipeFingerprint(next) === recipeFingerprint(this.recipe)) {
      this.recipe = next;
      return { invalidated: [] };
    }
    for (const layer of invalidated) this.layerCache.delete(layer);
    this.compositeCache = null;
    this.recipe = next;
    return { invalidated };
  }

  /** 取单层结果（带缓存） */
  renderLayer(layer: LayerId): { surface: Surface; fingerprint: string; fromCache: boolean } {
    const fingerprint = layerFingerprint(this.recipe, layer);
    const cached = this.layerCache.get(layer);
    if (cached && cached.fingerprint === fingerprint) {
      return { surface: cached.surface, fingerprint, fromCache: true };
    }
    const surface = createLayerSurface(this.surfaceFactory, layer, fingerprint, this.recipe);
    this.layerCache.set(layer, { fingerprint, surface });
    return { surface, fingerprint, fromCache: false };
  }

  /** 合成笺纸（含光源叠加），内容层全部走缓存 */
  render(lightMode: LightMode): RenderResult {
    const fingerprints = layerFingerprints(this.recipe);
    const compositeKey = hashHex(`composite:${LAYER_IDS.map((l) => fingerprints[l]).join('|')}:${lightMode}`);
    if (this.compositeCache && this.compositeCache.key === compositeKey) {
      return {
        surface: this.compositeCache.surface,
        lightMode,
        fingerprints,
        renderedLayers: [],
        reusedLayers: [...LAYER_IDS],
        compositeKey,
      };
    }

    const layers = {} as Record<LayerId, Surface>;
    const renderedLayers: LayerId[] = [];
    for (const layerId of LAYER_IDS) {
      const result = this.renderLayer(layerId);
      layers[layerId] = result.surface;
      if (!result.fromCache) renderedLayers.push(layerId);
    }

    const { width, height } = this.recipe.size;
    const composite = this.surfaceFactory(width, height, `composite:${compositeKey}`);
    composeLayers(composite, layers);
    applyLightOverlay(composite.getContext(), lightMode, width, height);
    this.compositeCache = { key: compositeKey, surface: composite };

    return {
      surface: composite,
      lightMode,
      fingerprints,
      renderedLayers,
      reusedLayers: LAYER_IDS.filter((layer) => !renderedLayers.includes(layer)),
      compositeKey,
    };
  }

  /**
   * 入匣导出：600x800 高清图 + 木匣边框。
   * 同参数+同光源的导出复用同一不可变产物；不同次导出互不影响。
   */
  export(lightMode: LightMode): ExportArtifact {
    const composite = this.render(lightMode);
    const key = hashHex(`export:${composite.compositeKey}`);
    const cached = this.exportCache.get(key);
    if (cached) return cached;
    const artifact = renderExportArtifact(this.surfaceFactory, key, composite.surface, this.recipe, lightMode);
    this.exportCache.set(key, artifact);
    this.artifacts.push(artifact);
    return artifact;
  }
}
