import type { RecipeItem, SmokeParticle } from '../types/index.ts';
import { mixColors } from '../utils/color.ts';

export const MAX_ITEM_GRAMS = 5;
export const MAX_TOTAL_GRAMS = 10;
export const GRIND_READY = 100;
export const BURN_DURATION_TICKS = 60;
export const MAX_PARTICLES = 200;
export const DEFAULT_INCENSE_COLOR = '#8b7355';

export interface WorkshopState {
  currentRecipe: RecipeItem[];
  grindLevel: number;
  hasIncense: boolean;
  incenseColor: string;
  incenseOnCenser: boolean;
  isBurning: boolean;
  burntime: number;
  aromaScore: number;
  smokeParticles: SmokeParticle[];
  nextParticleId: number;
}

export function initialState(): WorkshopState {
  return {
    currentRecipe: [],
    grindLevel: 0,
    hasIncense: false,
    incenseColor: DEFAULT_INCENSE_COLOR,
    incenseOnCenser: false,
    isBurning: false,
    burntime: 0,
    aromaScore: 0,
    smokeParticles: [],
    nextParticleId: 0,
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function totalGrams(recipe: RecipeItem[]): number {
  return recipe.reduce((sum, item) => sum + item.grams, 0);
}

// 加料：仅在尚未合成香品时有效；单料不超过上限、总重不超过上限，且只增不减。
export function addIngredient(
  state: WorkshopState,
  name: string,
  grams: number,
  color: string,
): WorkshopState {
  if (state.hasIncense || state.isBurning || grams <= 0) return state;

  const currentTotal = totalGrams(state.currentRecipe);
  const existing = state.currentRecipe.find(item => item.name === name);
  const currentItemGrams = existing ? existing.grams : 0;

  const allowed = Math.min(
    grams,
    MAX_ITEM_GRAMS - currentItemGrams,
    MAX_TOTAL_GRAMS - currentTotal,
  );
  if (allowed <= 0) return state;

  const newGrams = currentItemGrams + allowed;
  const currentRecipe = existing
    ? state.currentRecipe.map(item =>
        item.name === name ? { ...item, grams: newGrams } : item,
      )
    : [...state.currentRecipe, { name, grams: newGrams, color }];

  return { ...state, currentRecipe };
}

// 研磨：仅在有料且未合成香品时有效，进度钳制在 0-100。
export function setGrind(state: WorkshopState, level: number): WorkshopState {
  if (state.hasIncense || state.currentRecipe.length === 0) return state;
  const grindLevel = clamp(level, 0, GRIND_READY);
  if (grindLevel === state.grindLevel) return state;
  return { ...state, grindLevel };
}

// 合成：磨满且有料且尚无香品时生效；配方被消耗、研磨进度真正归零。
export function createIncense(state: WorkshopState): WorkshopState {
  if (state.hasIncense) return state;
  if (state.grindLevel < GRIND_READY || state.currentRecipe.length === 0) {
    return state;
  }

  const incenseColor = mixColors(
    state.currentRecipe.map(item => ({ color: item.color, weight: item.grams })),
  );

  return {
    ...state,
    hasIncense: true,
    incenseColor,
    currentRecipe: [],
    grindLevel: 0,
  };
}

// 放置：仅在有香品且未放置、未燃烧时有效，重复放置为幂等空操作。
export function placeIncenseOnCenser(state: WorkshopState): WorkshopState {
  if (!state.hasIncense || state.incenseOnCenser || state.isBurning) return state;
  return { ...state, incenseOnCenser: true };
}

// 点燃：仅在香品已放置且未燃烧时有效；计时、评分、烟雾一并归零起步。
export function ignite(state: WorkshopState): WorkshopState {
  if (!state.incenseOnCenser || state.isBurning) return state;
  return {
    ...state,
    isBurning: true,
    burntime: 0,
    aromaScore: 0,
    smokeParticles: [],
  };
}

// 燃烧推进：仅在燃烧中有效；计时、烟雾、评分由同一节拍推进，燃尽后统一收尾。
export function tick(
  state: WorkshopState,
  now: number = Date.now(),
  random: () => number = Math.random,
): WorkshopState {
  if (!state.isBurning) return state;

  let particles = state.smokeParticles;
  let nextParticleId = state.nextParticleId;

  if (state.burntime % 5 === 0) {
    const particleCount = 5 + Math.floor(random() * 4);
    const spawned: SmokeParticle[] = [];
    for (let i = 0; i < particleCount; i++) {
      spawned.push({
        id: nextParticleId++,
        x: 50 + (random() - 0.5) * 20,
        y: 0,
        diameter: 6 + random() * 2,
        opacity: 0.85 + random() * 0.1,
        velocityX: (random() - 0.5) * 2,
        velocityY: -1.5 - random() * 1.5,
        createdAt: now,
        color: state.incenseColor,
      });
    }
    particles = [...particles, ...spawned];
    if (particles.length > MAX_PARTICLES) {
      particles = particles.slice(-MAX_PARTICLES);
    }
  }

  const maxLifetime = 5000;
  particles = particles
    .map(particle => {
      const age = now - particle.createdAt;
      const lifeProgress = Math.min(1, age / maxLifetime);
      const brownianX = (random() - 0.5) * 3;
      const brownianY = (random() - 0.5) * 1;
      const maxRise = 50 + random() * 70;
      return {
        ...particle,
        x: particle.x + particle.velocityX * 0.5 + brownianX,
        y: particle.y + particle.velocityY + brownianY - maxRise * 0.02,
        diameter: Math.max(0, particle.diameter - lifeProgress * 5),
        opacity: Math.max(0, particle.opacity - lifeProgress * 0.9),
      };
    })
    .filter(particle => particle.opacity > 0.05 && particle.diameter > 0.5);

  const burntime = state.burntime + 1;
  const aromaScore = Math.min(
    100,
    state.aromaScore + (burntime % 10 === 0 ? 2 : 0),
  );

  if (burntime >= BURN_DURATION_TICKS) {
    return {
      ...state,
      isBurning: false,
      burntime,
      aromaScore,
      smokeParticles: [],
      nextParticleId,
    };
  }

  return { ...state, burntime, aromaScore, smokeParticles: particles, nextParticleId };
}

// 重置：回到初始状态，任何时刻调用都幂等。
export function reset(): WorkshopState {
  return initialState();
}
