export type ElementType = '金' | '木' | '水' | '火' | '土';
export type GameState = 'exploring' | 'refining' | 'result';
export type PillQuality = '凡品' | '灵品' | '仙品';

export interface HerbData {
  id: string;
  name: string;
  element: ElementType;
  color: number;
  potency: number;
  position: { x: number; y: number; z: number };
}

export interface PillData {
  id: string;
  name: string;
  quality: PillQuality;
  effects: string[];
  matchScore: number;
  color: number;
}

export interface FurnaceSlot {
  element: ElementType;
  herb: HerbData | null;
  isCorrect: boolean;
}

export interface GameEvents {
  onHerbCollected: (herb: HerbData) => void;
  onStateChange: (state: GameState) => void;
  onFurnaceUpdate: (slots: FurnaceSlot[], furnaceColor: number) => void;
  onRefiningStart: () => void;
  onRefiningComplete: (pill: PillData) => void;
  onUIUpdate: (data: any) => void;
}

export interface PlayerState {
  position: { x: number; y: number; z: number };
  rotation: number;
  isWalking: boolean;
  isPicking: boolean;
  basketCount: number;
}

export const ELEMENT_COLORS: Record<ElementType, number> = {
  '金': 0xFFD700,
  '木': 0x228B22,
  '水': 0x4169E1,
  '火': 0xFF4500,
  '土': 0x8B4513
};

export const ELEMENT_NAMES: ElementType[] = ['金', '木', '水', '火', '土'];

export const HERB_TYPES = [
  { name: '火灵草', element: '火' as ElementType, color: 0xFF4500 },
  { name: '水仙兰', element: '水' as ElementType, color: 0x4169E1 },
  { name: '金线莲', element: '金' as ElementType, color: 0xFFD700 },
  { name: '木灵芝', element: '木' as ElementType, color: 0x228B22 },
  { name: '土茯苓', element: '土' as ElementType, color: 0x8B4513 },
  { name: '冰魄花', element: '水' as ElementType, color: 0x87CEEB },
  { name: '炎龙藤', element: '火' as ElementType, color: 0xFF6347 },
  { name: '玄铁叶', element: '金' as ElementType, color: 0xC0C0C0 }
];
