import { ElementType, FurnaceSlot, HerbData, PillData, PillQuality, ELEMENT_COLORS, ELEMENT_NAMES } from '../../types';

/** 投料结果：ok 表示槽位接受了草药；rejected 表示被拒绝且状态未变 */
export type PlaceResult =
  | { ok: true; correct: boolean }
  | { ok: false; reason: 'slot_occupied' | 'invalid_slot' };

export const EMPTY_FURNACE_COLOR = 0x333333;

/** 进入炼丹所需的最低草药数量 */
export const MIN_HERBS_FOR_REFINING = 5;

/** 草药数量是否满足进入炼丹的条件 */
export function canEnterRefining(basketCount: number): boolean {
  return basketCount >= MIN_HERBS_FOR_REFINING;
}

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function rgbToHex(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/**
 * 熔炉核心逻辑：槽位状态、炉体颜色、匹配度、成丹结论。
 * 不依赖 THREE / DOM / 随机数 / 时钟，任意投料顺序下结果完全确定。
 */
export class FurnaceCore {
  private slots: FurnaceSlot[];

  constructor() {
    this.slots = ELEMENT_NAMES.map((element) => ({ element, herb: null, isCorrect: false }));
  }

  /**
   * 投料。
   * - 槽位已被占用或索引非法：拒绝，状态不变；
   * - 元素匹配：isCorrect = true；
   * - 元素不匹配：草药仍放入槽位并标记 isCorrect = false（由调用方决定是否从药篓消耗）。
   */
  placeHerb(herb: HerbData, slotIndex: number): PlaceResult {
    const slot = this.slots[slotIndex];
    if (!slot) return { ok: false, reason: 'invalid_slot' };
    if (slot.herb) return { ok: false, reason: 'slot_occupied' };

    slot.herb = herb;
    slot.isCorrect = herb.element === slot.element;
    return { ok: true, correct: slot.isCorrect };
  }

  getSlots(): FurnaceSlot[] {
    return this.slots.map((s) => ({ ...s, herb: s.herb ? { ...s.herb } : null }));
  }

  isAllSlotsFilled(): boolean {
    return this.slots.every((s) => s.herb !== null);
  }

  /** 已正确放入（元素匹配）的草药集合 */
  getCorrectHerbs(): HerbData[] {
    return this.slots.filter((s) => s.herb && s.isCorrect).map((s) => s.herb!);
  }

  /**
   * 炉体颜色：仅由"已正确放入的草药"的元素颜色平均混合决定，
   * 与投料顺序无关；无正确草药时为默认暗色。
   */
  getFurnaceColor(): number {
    const correct = this.slots.filter((s) => s.herb && s.isCorrect);
    if (correct.length === 0) return EMPTY_FURNACE_COLOR;

    let r = 0;
    let g = 0;
    let b = 0;
    correct.forEach((slot) => {
      const [cr, cg, cb] = hexToRgb(ELEMENT_COLORS[slot.element]);
      r += cr;
      g += cg;
      b += cb;
    });
    return rgbToHex(
      Math.round(r / correct.length),
      Math.round(g / correct.length),
      Math.round(b / correct.length)
    );
  }

  /** 匹配度 = 元素匹配的槽位数 / 槽位总数，仅取决于槽内草药的元素构成 */
  calculateMatchScore(): number {
    const correctCount = this.slots.filter((s) => s.isCorrect).length;
    return correctCount / this.slots.length;
  }

  static qualityForScore(matchScore: number): PillQuality {
    if (matchScore >= 0.9) return '仙品';
    if (matchScore >= 0.6) return '灵品';
    return '凡品';
  }

  static colorForQuality(quality: PillQuality): number {
    switch (quality) {
      case '仙品':
        return 0xffd700;
      case '灵品':
        return 0x9966ff;
      default:
        return 0x888888;
    }
  }

  static effectsForQuality(quality: PillQuality): string[] {
    switch (quality) {
      case '仙品':
        return ['起死回生，肉白骨', '飞升成仙，长生不老', '灵力充沛，修为大增'];
      case '灵品':
        return ['修为大增五十年', '百病不侵，益寿延年', '灵力精纯，修炼加速'];
      default:
        return ['强身健体，气力倍增', '治愈外伤，恢复元气', '小补气血，精神焕发'];
    }
  }

  /**
   * 丹名由槽内草药的元素构成确定性推导（排序后哈希），
   * 相同元素组合无论放入顺序如何都得到同一个名字，不依赖随机数。
   */
  static pillNameForElements(elements: ElementType[]): string {
    const names = ['九转还魂丹', '混元益气丹', '太清辟谷丹', '凝神聚气丹', '太素丹'];
    const sorted = [...elements].sort();
    let hash = 0;
    for (const el of sorted) {
      for (let i = 0; i < el.length; i++) {
        hash = (hash * 31 + el.charCodeAt(i)) >>> 0;
      }
    }
    return names[hash % names.length];
  }

  /**
   * 成丹：品质、药效、颜色、名称全部由参与炼丹的草药元素构成唯一决定。
   * id 由调用方注入的 idGenerator 生成，保证离线可复现。
   */
  generatePill(idGenerator: () => string): PillData {
    const matchScore = this.calculateMatchScore();
    const quality = FurnaceCore.qualityForScore(matchScore);
    const elements = this.slots.filter((s) => s.herb).map((s) => s.herb!.element);

    return {
      id: idGenerator(),
      name: `${quality}${FurnaceCore.pillNameForElements(elements)}`,
      quality,
      effects: FurnaceCore.effectsForQuality(quality),
      matchScore,
      color: FurnaceCore.colorForQuality(quality)
    };
  }

  reset(): void {
    this.slots.forEach((slot) => {
      slot.herb = null;
      slot.isCorrect = false;
    });
  }
}
