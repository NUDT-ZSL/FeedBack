import { ELEMENT_COLORS, ELEMENT_NAMES } from '../types';
import type { ElementType, FurnaceSlot, HerbData, PillData, PillQuality } from '../types';

export interface PlacementResult {
  /** 草药是否进入了槽位（空槽重复投料返回 false）。 */
  accepted: boolean;
  /** 进入槽位的草药元素是否与槽位一致（空槽拒绝时恒为 false）。 */
  isCorrect: boolean;
}

export const FURNACE_SLOT_COUNT = ELEMENT_NAMES.length;
export const REFINING_DURATION_SECONDS = 2;
const IDLE_FURNACE_COLOR = 0x333333;
const PILL_NAMES = ['九转还魂丹', '混元益气丹', '太清辟谷丹', '凝神聚气丹', '太素丹'];

/** sRGB 分量（[0,1]）→ 线性分量，与 THREE.ColorManagement 的转换一致。 */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 线性分量 → sRGB 分量（[0,1]）。 */
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function hexToLinear(hex: number): { r: number; g: number; b: number } {
  return {
    r: srgbToLinear(((hex >> 16) & 255) / 255),
    g: srgbToLinear(((hex >> 8) & 255) / 255),
    b: srgbToLinear((hex & 255) / 255)
  };
}

function linearToHex(r: number, g: number, b: number): number {
  const toByte = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);
  return (toByte(linearToSrgb(r)) << 16) | (toByte(linearToSrgb(g)) << 8) | toByte(linearToSrgb(b));
}

/**
 * 仅由“已正确放入槽位的草药集合”决定炉体颜色：
 * 线性空间内对正确槽位五行色取均值，再转回 sRGB；
 * 没有正确槽位时回到空闲色。纯函数，与投料顺序无关。
 */
export function computeFurnaceColor(correctElements: ElementType[]): number {
  if (correctElements.length === 0) return IDLE_FURNACE_COLOR;

  let r = 0;
  let g = 0;
  let b = 0;
  for (const element of correctElements) {
    const linear = hexToLinear(ELEMENT_COLORS[element]);
    r += linear.r;
    g += linear.g;
    b += linear.b;
  }

  return linearToHex(
    r / correctElements.length,
    g / correctElements.length,
    b / correctElements.length
  );
}

/** 对槽位内容构成的字符串做确定性 FNV-1a 哈希。 */
function hashComposition(composition: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < composition.length; i++) {
    hash ^= composition.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 五行熔炉的全部判定状态（不含 THREE 网格/DOM）。
 * 同一组槽位内容经过任意顺序投料，最终状态与丹药结论完全一致。
 */
export class FurnaceCore {
  private slots: FurnaceSlot[];
  private currentColor: number = IDLE_FURNACE_COLOR;
  private isRefining: boolean = false;
  private refiningProgress: number = 0;

  constructor() {
    this.slots = ELEMENT_NAMES.map(element => ({
      element,
      herb: null,
      isCorrect: false
    }));
  }

  /**
   * 向指定槽位投料。
   * - 槽位已占用（含之前异元素投料）→ 拒绝，槽位不变；
   * - 同元素 → accepted 且 isCorrect；
   * - 异元素 → accepted 但 isCorrect=false，草药留在槽位（UI 侧不消耗药篓）。
   */
  public placeHerb(herbData: HerbData, slotIndex: number): PlacementResult {
    const slot = this.slots[slotIndex];
    if (!slot || slot.herb) {
      return { accepted: false, isCorrect: false };
    }

    const isCorrect = herbData.element === slot.element;
    slot.herb = { ...herbData };
    slot.isCorrect = isCorrect;

    this.currentColor = computeFurnaceColor(this.getCorrectElements());

    return { accepted: true, isCorrect };
  }

  public isAllSlotsFilled(): boolean {
    return this.slots.every(slot => slot.herb !== null);
  }

  /** 开始炼制；槽位未满时拒绝（返回 false），状态不变。 */
  public startRefining(): boolean {
    if (!this.isAllSlotsFilled()) return false;
    this.isRefining = true;
    this.refiningProgress = 0;
    return true;
  }

  /**
   * 以注入的时间增量推进炼制；累计达到 REFINING_DURATION_SECONDS 时
   * 恰好返回一次 true。时间来源完全由调用方控制（不读帧/不读墙钟）。
   */
  public update(deltaTime: number): boolean {
    if (!this.isRefining) return false;

    this.refiningProgress += deltaTime;
    if (this.refiningProgress >= REFINING_DURATION_SECONDS) {
      this.refiningProgress = REFINING_DURATION_SECONDS;
      this.isRefining = false;
      return true;
    }
    return false;
  }

  public getRefiningProgress(): number {
    return this.isRefining ? this.refiningProgress / REFINING_DURATION_SECONDS : 0;
  }

  public getRefiningElapsedSeconds(): number {
    return this.isRefining ? this.refiningProgress : 0;
  }

  public isCurrentlyRefining(): boolean {
    return this.isRefining;
  }

  public calculateMatchScore(): number {
    const correctCount = this.slots.filter(s => s.isCorrect).length;
    return correctCount / FURNACE_SLOT_COUNT;
  }

  private getCorrectElements(): ElementType[] {
    return this.slots.filter(s => s.herb && s.isCorrect).map(s => s.element);
  }

  public getCorrectHerbs(): HerbData[] {
    return this.slots.filter(s => s.herb && s.isCorrect).map(s => ({ ...s.herb! }));
  }

  /**
   * 当前槽位中的草药元素构成（按槽位元素排列），只记录元素、不记录名称/顺序。
   * 相同元素组合无论以什么顺序放入，key 完全相同。
   */
  public compositionKey(): string {
    return this.slots
      .map(slot => `${slot.element}=${slot.herb ? slot.herb.element : '空'}`)
      .join('|');
  }

  public getCurrentColor(): number {
    return this.currentColor;
  }

  public getSlots(): FurnaceSlot[] {
    return this.slots.map(s => ({
      element: s.element,
      herb: s.herb ? { ...s.herb } : null,
      isCorrect: s.isCorrect
    }));
  }

  /**
   * 由当前元素构成唯一决定丹药：品质、药效、颜色、匹配度、名称、ID。
   * 不使用随机数与墙钟时间；相同元素组合永远得到逐字段一致的结论。
   */
  public generatePill(explicitId?: string): PillData {
    const matchScore = this.calculateMatchScore();
    let quality: PillQuality;
    let effects: string[];
    let color: number;

    if (matchScore >= 0.9) {
      quality = '仙品';
      color = 0xffd700;
      effects = ['起死回生，肉白骨', '飞升成仙，长生不老', '灵力充沛，修为大增'];
    } else if (matchScore >= 0.6) {
      quality = '灵品';
      color = 0x9966ff;
      effects = ['修为大增五十年', '百病不侵，益寿延年', '灵力精纯，修炼加速'];
    } else {
      quality = '凡品';
      color = 0x888888;
      effects = ['强身健体，气力倍增', '治愈外伤，恢复元气', '小补气血，精神焕发'];
    }

    const compositionHash = hashComposition(this.compositionKey());
    const nameIndex = compositionHash % PILL_NAMES.length;
    const id = explicitId ?? `pill_${compositionHash.toString(16).padStart(8, '0')}`;

    return {
      id,
      name: `${quality}${PILL_NAMES[nameIndex]}`,
      quality,
      effects,
      matchScore,
      color
    };
  }

  public reset(): void {
    this.slots.forEach(slot => {
      slot.herb = null;
      slot.isCorrect = false;
    });
    this.currentColor = IDLE_FURNACE_COLOR;
    this.isRefining = false;
    this.refiningProgress = 0;
  }
}
