import { create } from 'zustand';
import type { StoreState, RecipeItem, SmokeParticle } from './types';
import { mixColors, getDominantColor } from './utils/color';

const MAX_PARTICLES = 200;
const MAX_TOTAL_GRAMS = 10;

let particleIdCounter = 0;

export const useStore = create<StoreState>((set, get) => ({
  currentRecipe: [],
  grindLevel: 0,
  burntime: 0,
  smokeParticles: [],
  isBurning: false,
  hasIncense: false,
  incenseColor: '#8b7355',
  incenseOnCenser: false,
  aromaScore: 0,

  addIngredient: (name: string, grams: number, color: string) => {
    const { currentRecipe } = get();
    const existingItem = currentRecipe.find(item => item.name === name);
    
    const currentTotal = currentRecipe.reduce((sum, item) => sum + item.grams, 0);
    const currentItemGrams = existingItem ? existingItem.grams : 0;
    const newItemGrams = Math.min(currentItemGrams + grams, 5);
    const newTotal = currentTotal - currentItemGrams + newItemGrams;

    if (newTotal > MAX_TOTAL_GRAMS) {
      const availableGrams = MAX_TOTAL_GRAMS - currentTotal + currentItemGrams;
      if (availableGrams <= currentItemGrams) return;
      const actualGrams = Math.min(availableGrams, 5);
      
      if (existingItem) {
        set({
          currentRecipe: currentRecipe.map(item =>
            item.name === name ? { ...item, grams: actualGrams } : item
          ),
        });
      } else if (availableGrams > 0) {
        set({
          currentRecipe: [...currentRecipe, { name, grams: Math.min(availableGrams, 5), color }],
        });
      }
      return;
    }

    if (existingItem) {
      set({
        currentRecipe: currentRecipe.map(item =>
          item.name === name ? { ...item, grams: newItemGrams } : item
        ),
      });
    } else {
      set({
        currentRecipe: [...currentRecipe, { name, grams: newItemGrams, color }],
      });
    }
  },

  setGrind: (level: number) => {
    set({ grindLevel: Math.min(100, Math.max(0, level)) });
  },

  createIncense: () => {
    const { currentRecipe, grindLevel } = get();
    if (grindLevel < 100 || currentRecipe.length === 0) return;

    const colorsForMix = currentRecipe.map(item => ({
      color: item.color,
      weight: item.grams,
    }));
    const incenseColor = mixColors(colorsForMix);

    set({
      hasIncense: true,
      incenseColor,
      grindLevel: 0,
    });
  },

  placeIncenseOnCenser: () => {
    const { hasIncense } = get();
    if (!hasIncense) return;
    set({ incenseOnCenser: true });
  },

  ignite: () => {
    const { incenseOnCenser, isBurning } = get();
    if (!incenseOnCenser || isBurning) return;
    set({ isBurning: true, burntime: 0, aromaScore: 0 });
  },

  tick: () => {
    const { isBurning, smokeParticles, burntime, currentRecipe, aromaScore, grindLevel } = get();
    
    if (!isBurning) return;

    const now = Date.now();
    const colorsForDominant = currentRecipe.map((item: RecipeItem) => ({
      color: item.color,
      weight: item.grams,
    }));
    const dominantColor = getDominantColor(colorsForDominant);

    let newParticles = [...smokeParticles];

    if (burntime % 5 === 0) {
      const particleCount = 5 + Math.floor(Math.random() * 4);
      const densityFactor = grindLevel / 100;
      
      for (let i = 0; i < particleCount; i++) {
        const newParticle: SmokeParticle = {
          id: particleIdCounter++,
          x: 50 + (Math.random() - 0.5) * 20,
          y: 0,
          diameter: 6 + Math.random() * 2,
          opacity: 0.85 + Math.random() * 0.1,
          velocityX: (Math.random() - 0.5) * 2,
          velocityY: -1.5 - Math.random() * 1.5,
          createdAt: now,
          color: dominantColor,
        };
        newParticles.push(newParticle);
      }

      if (newParticles.length > MAX_PARTICLES) {
        newParticles = newParticles.slice(-MAX_PARTICLES);
      }
    }

    const durationFactor = 1 + (grindLevel / 100);
    const maxLifetime = 3000 + 2000 * durationFactor;

    newParticles = newParticles
      .map(particle => {
        const age = now - particle.createdAt;
        const lifeProgress = Math.min(1, age / maxLifetime);
        
        const brownianX = (Math.random() - 0.5) * 3;
        const brownianY = (Math.random() - 0.5) * 1;
        
        const maxRise = 50 + Math.random() * 70;
        const riseProgress = Math.min(1, lifeProgress * 2);
        
        return {
          ...particle,
          x: particle.x + particle.velocityX * 0.5 + brownianX,
          y: particle.y + particle.velocityY + brownianY - maxRise * 0.02,
          diameter: Math.max(0, particle.diameter - lifeProgress * 5),
          opacity: Math.max(0, particle.opacity - lifeProgress * 0.9),
        };
      })
      .filter(particle => particle.opacity > 0.05 && particle.diameter > 0.5);

    const newBurntime = burntime + 1;
    const newAromaScore = Math.min(100, aromaScore + 2 * (newBurntime % 10 === 0 ? 1 : 0));

    set({
      smokeParticles: newParticles,
      burntime: newBurntime,
      aromaScore: newAromaScore,
    });

    if (newBurntime > 50 && newParticles.length === 0) {
      set({ isBurning: false });
    }
  },

  reset: () => {
    set({
      currentRecipe: [],
      grindLevel: 0,
      burntime: 0,
      smokeParticles: [],
      isBurning: false,
      hasIncense: false,
      incenseColor: '#8b7355',
      incenseOnCenser: false,
      aromaScore: 0,
    });
    particleIdCounter = 0;
  },
}));
