export interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  life: number;
}

export interface Batch {
  id: string;
  type: 'fine' | 'medium' | 'bran';
  weight: number;
  timestamp: string;
  gap: number;
  speed: number;
}

export interface AnimatingBag {
  id: string;
  type: 'fine' | 'medium' | 'bran';
  weight: number;
  x: number;
  y: number;
}

export interface MillState {
  valveOpening: number;
  wheelSpeed: number;
  gap: number;
  load: number;
  isOverloaded: boolean;
  isRunning: boolean;
  fineFlour: number;
  mediumFlour: number;
  bran: number;
  sieveProgress: number;
  particles: Particle[];
  batches: Batch[];
  animatingBags: AnimatingBag[];
}

export type MillAction =
  | { type: 'SET_VALVE'; payload: number }
  | { type: 'SET_GAP'; payload: number }
  | { type: 'TICK'; payload: number }
  | { type: 'PACK'; payload: 'fine' | 'medium' | 'bran' }
  | { type: 'LOAD_BATCHES'; payload: Batch[] }
  | { type: 'REMOVE_BAG_ANIMATION'; payload: string };

export type FlourType = 'fine' | 'medium' | 'bran';

export interface FlourOutput {
  fine: number;
  medium: number;
  bran: number;
}
