export type SpiceCategory = '沉檀' | '花香' | '果香' | '辛香' | '草本';
export type PerfumeType = '线香' | '香丸' | '香饼';
export type EffectKey = '安神' | '祛湿' | '提神' | '暖身';

export interface Spice {
  id: string;
  name: string;
  category: SpiceCategory;
  effects: Record<EffectKey, number>;
  color: string;
  description: string;
}

export interface PerfumeIngredient {
  spiceId: string;
  percentage: number;
}

export interface Perfume {
  id: string;
  name: string;
  description: string;
  tags: string[];
  type: PerfumeType;
  ingredients: PerfumeIngredient[];
  effects: Record<EffectKey, number>;
  createdAt: string;
}

export interface MortarItem {
  spice: Spice;
  percentage: number;
}

export interface DragState {
  isDragging: boolean;
  spice: Spice | null;
  position: { x: number; y: number };
  offset: { x: number; y: number };
}

export interface SmokeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  life: number;
  maxLife: number;
}
