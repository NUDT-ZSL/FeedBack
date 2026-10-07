export type Element = 'wood' | 'fire' | 'earth' | 'metal' | 'water';

export type PillRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface Herb {
  id: string;
  name: string;
  element: Element;
  color: string;
  shape: 'mushroom' | 'root' | 'crystal' | 'powder' | 'stone' | 'leaf';
  emoji: string;
}

export interface Pill {
  id: string;
  name: string;
  element: Element;
  elements: Element[];
  effect: string;
  rarity: PillRarity;
  color: string;
  glowColor: string;
  ingredients: string[];
  fireTemp: number;
  airFlow: number;
}

export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: 'smoke' | 'flame' | 'spark' | 'ingredient' | 'pill' | 'aura' | 'ring';
}

export interface DragState {
  isDragging: boolean;
  herb: Herb | null;
  offsetX: number;
  offsetY: number;
  currentX: number;
  currentY: number;
}

export interface FurnaceState {
  temperature: number;
  airFlow: number;
  flameHeight: number;
  flameColor: string;
  baseFireColor: string;
  currentElements: Element[];
  shakeTime: number;
  beamTimes: number[];
  beamElements: (Element | null)[];
}

export interface GourdPill {
  pill: Pill;
  storedAt: number;
}

export type GourdColor = 'purple' | 'jade' | 'black';

export interface Gourd {
  color: GourdColor;
  name: string;
  pills: GourdPill[];
  maxPills: number;
}
