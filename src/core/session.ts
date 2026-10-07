import type { HerbData, PillData } from '../types';
import { FurnaceCore } from './furnace';
import { canEnterRefining, dropHerbFromBasket } from './rules';

/**
 * 无浏览器、无渲染的采药→投料→炼丹→成丹会话。
 * 与 GameManager 使用同一套核心规则（FurnaceCore / rules），
 * 时间推进完全由 update(deltaTime) 的调用方注入，结果可离线复现。
 */
export class AlchemySession {
  public readonly furnace: FurnaceCore;
  private basket: HerbData[] = [];
  private pill: PillData | null = null;

  constructor(furnace: FurnaceCore = new FurnaceCore()) {
    this.furnace = furnace;
  }

  /** 采集一株草药放入药篓。 */
  public collect(herb: HerbData): void {
    this.basket.push({ ...herb });
  }

  public getBasket(): HerbData[] {
    return this.basket.map(h => ({ ...h }));
  }

  public canEnterRefining(): boolean {
    return canEnterRefining(this.basket.length);
  }

  /**
   * 从药篓投料到指定槽位，语义与 GameManager.dropHerbToSlot 一致；
   * 全部槽位放满后自动开始炼制。
   */
  public dropHerbToSlot(herbId: string, slotIndex: number): boolean {
    const result = dropHerbFromBasket(this.basket, herbId, herb =>
      this.furnace.placeHerb(herb, slotIndex).isCorrect
    );
    if (!result.found) return false;

    if (this.furnace.isAllSlotsFilled()) {
      this.furnace.startRefining();
    }

    return result.isCorrect;
  }

  public isRefining(): boolean {
    return this.furnace.isCurrentlyRefining();
  }

  /**
   * 推进炼制时间；炼制完成的那一刻生成并返回丹药（只生成一次），
   * 其余时刻返回 null。
   */
  public update(deltaTime: number): PillData | null {
    if (this.pill) return null;
    if (this.furnace.update(deltaTime)) {
      this.pill = this.furnace.generatePill();
      return { ...this.pill };
    }
    return null;
  }

  public getPill(): PillData | null {
    return this.pill ? { ...this.pill } : null;
  }
}
