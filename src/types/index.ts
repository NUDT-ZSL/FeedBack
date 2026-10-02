export interface RecipeItem {
  name: string;
  grams: number;
  color: string;
}

export interface SmokeParticle {
  id: number;
  x: number;
  y: number;
  diameter: number;
  opacity: number;
  velocityX: number;
  velocityY: number;
  createdAt: number;
  color: string;
}

export interface Ingredient {
  name: string;
  color: string;
  powderColor: string;
  description: string;
  maxGrams: number;
}

export interface StoreState {
  currentRecipe: RecipeItem[];
  grindLevel: number;
  burntime: number;
  smokeParticles: SmokeParticle[];
  isBurning: boolean;
  hasIncense: boolean;
  incenseColor: string;
  incenseOnCenser: boolean;
  aromaScore: number;
  addIngredient: (name: string, grams: number, color: string, powderColor: string) => void;
  setGrind: (level: number) => void;
  createIncense: () => void;
  placeIncenseOnCenser: () => void;
  ignite: () => void;
  tick: () => void;
  reset: () => void;
}

export const INGREDIENTS: Ingredient[] = [
  {
    name: '龙涎香',
    color: '#d4d4d4',
    powderColor: '#e8e8e8',
    description: '半透明白色，温润持久，似海上晨曦',
    maxGrams: 5,
  },
  {
    name: '乳香',
    color: '#f5f5dc',
    powderColor: '#fffacd',
    description: '淡黄色，清新恬淡，如林间清风',
    maxGrams: 5,
  },
  {
    name: '没药',
    color: '#b87333',
    powderColor: '#cd853f',
    description: '琥珀色，浓郁醇厚，似西域暖阳',
    maxGrams: 5,
  },
];
