import type { HerbData } from '../types';

/** 进入炼丹所需的最少草药数量（与 GameManager 的判定共用同一来源）。 */
export const MIN_HERBS_FOR_REFINING = 5;

/** 草药数量不足时拒绝进入炼丹。 */
export function canEnterRefining(collectedCount: number): boolean {
  return collectedCount >= MIN_HERBS_FOR_REFINING;
}

export interface DropResult {
  /** 药篓中是否存在该草药。 */
  found: boolean;
  /** 草药元素与槽位是否匹配（与 GameManager.dropHerbToSlot 的返回值语义一致）。 */
  isCorrect: boolean;
}

/**
 * 药篓投料规则（GameManager 与离线会话共用）：
 * - 药篓中没有该草药 → found=false，什么也不发生；
 * - 放入成功且元素匹配 → 从药篓移除；
 * - 元素不匹配（或槽位被占用）→ 草药留在药篓。
 */
export function dropHerbFromBasket(
  basket: HerbData[],
  herbId: string,
  place: (herb: HerbData) => boolean
): DropResult {
  const index = basket.findIndex(h => h.id === herbId);
  if (index === -1) {
    return { found: false, isCorrect: false };
  }

  const isCorrect = place(basket[index]);
  if (isCorrect) {
    basket.splice(index, 1);
  }

  return { found: true, isCorrect };
}
