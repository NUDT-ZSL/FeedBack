import { createRenderPlan, normalizeConfig, planHash } from './artEngine';
import { exportArt, type ExportArtifact } from './exportService';
import { hashString } from './hash';
import { HistoryStore } from './historyStore';
import { parsePrompt } from './keywordParser';
import { getTheme, randomTheme } from './paletteManager';
import { SeededRandom } from './random';
import {
  ALL_SHAPES,
  ALL_TEXTURES,
  type ArtConfig,
  type CanvasSpec,
  type HistoryItem,
  type RenderPlan,
} from './types';

export interface GeneratorOptions {
  canvas: CanvasSpec;
  capacity?: number;
  /** 可注入时钟，测试时传入固定值以获得完全确定的时间戳。 */
  now?: () => number;
}

export interface AdjustPatch {
  hueShift?: number;
  complexity?: number;
  strokeWidth?: number;
}

/**
 * 抽象艺术生成会话：把解析、渲染计划、历史记录、导出串成一条
 * 单一数据通路。预览（getPreviewPlan）与导出（exportCurrent）
 * 都从当前历史项的同一份参数快照出发，保证两者一致。
 */
export class ArtGeneratorSession {
  private readonly store: HistoryStore<HistoryItem>;
  private readonly now: () => number;
  private canvas: CanvasSpec;
  private seq = 0;

  constructor(options: GeneratorOptions) {
    this.canvas = { ...options.canvas };
    this.now = options.now ?? (() => Date.now());
    this.store = new HistoryStore<HistoryItem>(options.capacity ?? 10);
  }

  get history(): readonly HistoryItem[] {
    return this.store.items;
  }

  get current(): HistoryItem | null {
    return this.store.current;
  }

  get currentIndex(): number {
    return this.store.currentIndex;
  }

  get canUndo(): boolean {
    return this.store.canUndo;
  }

  get canRedo(): boolean {
    return this.store.canRedo;
  }

  get canvasSpec(): CanvasSpec {
    return { ...this.canvas };
  }

  /** 根据 prompt 生成；seed 缺省时由 prompt 哈希决定，同一 prompt 结果稳定。 */
  generate(prompt: string, seed: number = hashString(prompt)): HistoryItem {
    const hints = parsePrompt(prompt);
    const rng = new SeededRandom(seed);
    const theme = hints.themeName ? getTheme(hints.themeName) : randomTheme(rng);
    const config = normalizeConfig({
      prompt,
      themeName: theme.name,
      colors: [...theme.colors],
      shapes: hints.shapes ?? [rng.pick(ALL_SHAPES), rng.pick(ALL_SHAPES)],
      texture: hints.texture ?? rng.pick(ALL_TEXTURES),
      hueShift: 0,
      complexity: 5,
      strokeWidth: 2,
      seed,
    });
    return this.commit(config);
  }

  /** 随机惊喜：随机主题 + 随机形状规则。seed 缺省时由时钟与序号派生。 */
  surprise(seed?: number): HistoryItem {
    const actualSeed = seed ?? hashString(`${this.now()}:${this.seq}`);
    const rng = new SeededRandom(actualSeed);
    const theme = randomTheme(rng);
    const config = normalizeConfig({
      prompt: '[surprise]',
      themeName: theme.name,
      colors: [...theme.colors],
      shapes: [rng.pick(ALL_SHAPES), rng.pick(ALL_SHAPES)],
      texture: rng.pick(ALL_TEXTURES),
      hueShift: 0,
      complexity: rng.int(1, 10),
      strokeWidth: rng.int(1, 5),
      seed: actualSeed,
    });
    return this.commit(config);
  }

  /** 微调当前项参数（滑块），原位更新历史记录中的当前项。 */
  adjust(patch: AdjustPatch): HistoryItem | null {
    const current = this.store.current;
    if (!current) {
      return null;
    }
    return this.replaceCurrent({ ...current.config, ...patch });
  }

  /** 切换当前项的颜色主题，其余参数保持不变。 */
  setTheme(themeName: string): HistoryItem | null {
    const current = this.store.current;
    if (!current) {
      return null;
    }
    const theme = getTheme(themeName);
    return this.replaceCurrent({
      ...current.config,
      themeName: theme.name,
      colors: [...theme.colors],
    });
  }

  /** 窗口尺寸 / 设备像素比变化：后续渲染与当前记录同步更新。 */
  resize(canvas: CanvasSpec): void {
    this.canvas = { ...canvas };
    const current = this.store.current;
    if (current) {
      this.store.updateCurrent(this.buildItem(current.id, current.config));
    }
  }

  undo(): HistoryItem | null {
    return this.store.undo();
  }

  redo(): HistoryItem | null {
    return this.store.redo();
  }

  clear(): void {
    this.store.clear();
  }

  select(id: string): HistoryItem | null {
    return this.store.select(id);
  }

  /** 当前画布应当显示的内容；无记录时为 null。 */
  getPreviewPlan(): RenderPlan | null {
    const current = this.store.current;
    return current ? createRenderPlan(current.config, current.canvas) : null;
  }

  /** 导出当前项；与预览使用同一份参数快照与同一渲染路径。 */
  exportCurrent(): ExportArtifact | null {
    const current = this.store.current;
    return current ? exportArt(current) : null;
  }

  private commit(config: ArtConfig): HistoryItem {
    const item = this.buildItem(`art-${(this.seq += 1)}`, config);
    this.store.push(item);
    return item;
  }

  private replaceCurrent(config: ArtConfig): HistoryItem | null {
    const current = this.store.current;
    if (!current) {
      return null;
    }
    return this.store.updateCurrent(this.buildItem(current.id, config));
  }

  private buildItem(id: string, config: ArtConfig): HistoryItem {
    const normalized = normalizeConfig(config);
    const canvas = { ...this.canvas };
    return {
      id,
      prompt: normalized.prompt,
      config: normalized,
      canvas,
      thumbnail: `thumb:${planHash(createRenderPlan(normalized, canvas))}`,
      timestamp: this.now(),
    };
  }
}
