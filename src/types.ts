export type AnimalType = 'rabbit' | 'sheep' | 'deer' | 'hamster' | 'squirrel' | 'wolf' | 'eagle' | 'snake';
export type Diet = 'herbivore' | 'carnivore';

export interface Animal {
  id: number;
  type: AnimalType;
  diet: Diet;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hunger: number;
  maxHunger: number;
  energy: number;
  maxEnergy: number;
  color: string;
  size: number;
  isDying: boolean;
  deathAnimation: number;
}

export interface EnvironmentParams {
  temperature: number;
  precipitation: number;
  light: number;
  pollution: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  opacity: number;
  offsetY: number;
}

export interface AnimalConfig {
  diet: Diet;
  color: string;
  size: number;
  hungerRate: number;
  maxEnergy: number;
  feedingRate: number;
  shape: 'ellipse' | 'diamond' | 'rect' | 'circle' | 'pentagon' | 'triangle' | 'trapezoid' | 'wave';
  name: string;
}

export const ENERGY_TRANSFER_RATIO = 0.5;
export const METABOLIC_DRAIN_SCALE = 10;

export const ANIMAL_CONFIG: Record<AnimalType, AnimalConfig> = {
  rabbit: { diet: 'herbivore', color: '#ffffff', size: 12, hungerRate: 0.1, maxEnergy: 80, feedingRate: 8, shape: 'ellipse', name: '兔子' },
  sheep: { diet: 'herbivore', color: '#f5f5dc', size: 18, hungerRate: 0.08, maxEnergy: 120, feedingRate: 7, shape: 'diamond', name: '羊' },
  deer: { diet: 'herbivore', color: '#8b4513', size: 22, hungerRate: 0.06, maxEnergy: 150, feedingRate: 6, shape: 'rect', name: '鹿' },
  hamster: { diet: 'herbivore', color: '#ffa500', size: 8, hungerRate: 0.15, maxEnergy: 60, feedingRate: 10, shape: 'circle', name: '仓鼠' },
  squirrel: { diet: 'herbivore', color: '#a0522d', size: 10, hungerRate: 0.12, maxEnergy: 70, feedingRate: 9, shape: 'pentagon', name: '松鼠' },
  wolf: { diet: 'carnivore', color: '#808080', size: 20, hungerRate: 0.05, maxEnergy: 200, feedingRate: 0, shape: 'triangle', name: '狼' },
  eagle: { diet: 'carnivore', color: '#1e3a5f', size: 16, hungerRate: 0.07, maxEnergy: 150, feedingRate: 0, shape: 'trapezoid', name: '鹰' },
  snake: { diet: 'carnivore', color: '#228b22', size: 14, hungerRate: 0.09, maxEnergy: 120, feedingRate: 0, shape: 'wave', name: '蛇' },
};

export const PREDATION_MAP: Record<string, AnimalType[]> = {
  wolf: ['rabbit', 'sheep', 'deer', 'hamster'],
  eagle: ['rabbit', 'squirrel', 'hamster'],
  snake: ['hamster', 'squirrel', 'rabbit'],
};

export const HERBIVORES: AnimalType[] = ['rabbit', 'sheep', 'deer', 'hamster', 'squirrel'];
export const CARNIVORES: AnimalType[] = ['wolf', 'eagle', 'snake'];
export const ALL_ANIMALS: AnimalType[] = [...HERBIVORES, ...CARNIVORES];

export const FOOD_CHAIN_NODES: Array<{ type: AnimalType; x: number; y: number }> = [
  { type: 'wolf', x: 140, y: 30 },
  { type: 'eagle', x: 230, y: 30 },
  { type: 'snake', x: 50, y: 30 },
  { type: 'rabbit', x: 80, y: 90 },
  { type: 'sheep', x: 140, y: 90 },
  { type: 'deer', x: 200, y: 90 },
  { type: 'hamster', x: 110, y: 150 },
  { type: 'squirrel', x: 170, y: 150 },
];
