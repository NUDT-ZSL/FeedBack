import { HerbData, PillData } from '../../types';
import { FurnaceCore, PlaceResult, canEnterRefining, MIN_HERBS_FOR_REFINING } from './furnaceCore';
import { findCollectibleHerb } from './collection';
import { generateHerbPlacements, PlacementConfig, checkHerbPosition } from './placement';
import { createIdGenerator, RandomSource } from './random';
import { HERB_TYPES } from '../../types';

export interface SimHerb {
  data: HerbData;
  collected: boolean;
}

export interface RefineAttemptResult {
  accepted: boolean;
  placeResult: PlaceResult;
  autoRefiningStarted: boolean;
}

export interface SimSummary {
  placement: { count: number; allConstraintsHeld: boolean; rejectionCounts: number[] };
  collectedCount: number;
  basket: HerbData[];
  slots: ReturnType<FurnaceCore['getSlots']>;
  furnaceColor: number;
  pill: PillData | null;
  refusalReason: string | null;
}

/**
 * 地形生成 -> 采集 -> 投料 -> 成丹 的离脑（headless）确定性模拟器。
 * 不触碰 THREE / DOM / requestAnimationFrame / Date.now：
 * 地形高度函数、随机源均为注入参数，时间推进由调用方用固定脚本控制。
 */
export class ValleySimulator {
  private random: RandomSource;
  private heightAt: (x: number, z: number) => number;
  private config: PlacementConfig;
  private herbs: SimHerb[] = [];
  private basket: HerbData[] = [];
  private furnace = new FurnaceCore();
  private herbIdGenerator: () => string;
  private pillIdGenerator: () => string;
  private refusalReason: string | null = null;

  constructor(
    random: RandomSource,
    heightAt: (x: number, z: number) => number,
    config: PlacementConfig,
    idSeedRandom?: RandomSource
  ) {
    this.random = random;
    this.heightAt = heightAt;
    this.config = config;
    const idRandom = idSeedRandom ?? random;
    this.herbIdGenerator = createIdGenerator('herb', idRandom);
    this.pillIdGenerator = createIdGenerator('pill', idRandom);
  }

  /** 生成地形草药分布，返回前逐点复核约束 */
  populateTerrain(): SimHerb[] {
    const result = generateHerbPlacements(this.random, this.heightAt, this.config);
    const allConstraintsHeld = result.points.every((p) =>
      checkHerbPosition(p.x, p.z, this.heightAt(p.x, p.z), this.config).valid
    );
    if (!allConstraintsHeld) {
      throw new Error('模拟器自检失败：生成的草药落点不满足约束');
    }
    if (result.points.length !== this.config.count) {
      throw new Error(`模拟器自检失败：草药数量 ${result.points.length} 与预期 ${this.config.count} 不符`);
    }

    this.herbs = result.points.map((p) => {
      const typeIndex = Math.floor(this.random.next() * HERB_TYPES.length);
      const herbType = HERB_TYPES[typeIndex];
      const data: HerbData = {
        id: this.herbIdGenerator(),
        name: herbType.name,
        element: herbType.element,
        color: herbType.color,
        potency: 0.5 + this.random.next() * 0.5,
        position: { x: p.x, y: p.y, z: p.z }
      };
      return { data, collected: false };
    });
    return this.herbs;
  }

  getHerbs(): SimHerb[] {
    return this.herbs;
  }

  /** 玩家移动到指定位置并尝试采集（半径与 GameManager 碰撞采集一致，1.5） */
  moveAndCollect(x: number, y: number, z: number, radius: number = 1.5): HerbData | null {
    const remaining = this.herbs.filter((h) => !h.collected);
    const indexInFiltered = findCollectibleHerb({ x, y, z }, remaining, radius);
    if (indexInFiltered === -1) return null;
    const target = remaining[indexInFiltered];
    target.collected = true;
    this.basket.push(target.data);
    return target.data;
  }

  getBasket(): HerbData[] {
    return [...this.basket];
  }

  /** 尝试进入炼丹房：草药不足时走拒绝路径，返回 false 并记录原因 */
  tryEnterRefining(): boolean {
    if (!canEnterRefining(this.basket.length)) {
      this.refusalReason = `至少需要 ${MIN_HERBS_FOR_REFINING} 株草药才能炼丹，当前仅有 ${this.basket.length} 株`;
      return false;
    }
    this.refusalReason = null;
    return true;
  }

  getRefusalReason(): string | null {
    return this.refusalReason;
  }

  /**
   * 投料。规则与 GameManager/Furnace 保持一致：
   * - 槽位非法 / 已被占用：拒绝，药篓与炉体均不变；
   * - 接受投料（无论元素是否匹配）：该草药从药篓消耗；
   * - 五行槽全部填满时自动开始炼制。
   */
  placeHerb(herbId: string, slotIndex: number): RefineAttemptResult {
    const herbIndex = this.basket.findIndex((h) => h.id === herbId);
    if (herbIndex === -1) {
      return { accepted: false, placeResult: { ok: false, reason: 'invalid_slot' }, autoRefiningStarted: false };
    }
    const herb = this.basket[herbIndex];
    const placeResult = this.furnace.placeHerb(herb, slotIndex);
    if (placeResult.ok) {
      this.basket.splice(herbIndex, 1);
    }
    const autoRefiningStarted = this.furnace.isAllSlotsFilled();
    return { accepted: placeResult.ok, placeResult, autoRefiningStarted };
  }

  getSlots() {
    return this.furnace.getSlots();
  }

  getFurnaceColor(): number {
    return this.furnace.getFurnaceColor();
  }

  /** 成丹（槽满后方可调用）；结论仅由元素构成决定 */
  completeRefining(): PillData {
    if (!this.furnace.isAllSlotsFilled()) {
      throw new Error('五行槽未全部填满，无法成丹');
    }
    return this.furnace.generatePill(this.pillIdGenerator);
  }

  summarize(): SimSummary {
    return {
      placement: {
        count: this.herbs.length,
        allConstraintsHeld: this.herbs.every((h) =>
          checkHerbPosition(
            h.data.position.x,
            h.data.position.z,
            this.heightAt(h.data.position.x, h.data.position.z),
            this.config
          ).valid
        ),
        rejectionCounts: []
      },
      collectedCount: this.herbs.filter((h) => h.collected).length,
      basket: this.getBasket(),
      slots: this.furnace.getSlots(),
      furnaceColor: this.furnace.getFurnaceColor(),
      pill: null,
      refusalReason: this.refusalReason
    };
  }
}
