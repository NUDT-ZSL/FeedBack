import { v4 as uuidv4 } from 'uuid';
import { Element, Herb, Pill, PillRarity } from './types';
import { ELEMENT_COLORS, ELEMENT_GENERATES, PILL_RECIPES, RARITY_COLORS } from './constants';

export function generatePillId(): string {
  return uuidv4();
}

export function hasGeneratingCombination(elements: Element[]): boolean {
  if (elements.length < 2) return false;
  const uniqueElements = [...new Set(elements)];
  for (let i = 0; i < uniqueElements.length; i++) {
    for (let j = 0; j < uniqueElements.length; j++) {
      if (i !== j && ELEMENT_GENERATES[uniqueElements[i]] === uniqueElements[j]) {
        return true;
      }
    }
  }
  return false;
}

export function getBeamElements(elements: Element[]): (Element | null)[] {
  const result: (Element | null)[] = [null, null, null, null, null, null, null, null, null];
  const uniqueElements = [...new Set(elements)];
  const generatingPairs: Element[] = [];
  
  for (let i = 0; i < uniqueElements.length; i++) {
    for (let j = 0; j < uniqueElements.length; j++) {
      if (i !== j && ELEMENT_GENERATES[uniqueElements[i]] === uniqueElements[j]) {
        if (!generatingPairs.includes(uniqueElements[i])) {
          generatingPairs.push(uniqueElements[i]);
        }
        if (!generatingPairs.includes(uniqueElements[j])) {
          generatingPairs.push(uniqueElements[j]);
        }
      }
    }
  }
  
  for (let i = 0; i < generatingPairs.length && i < 9; i++) {
    result[i] = generatingPairs[i];
  }
  
  return result;
}

export function mixFireColor(currentColor: string, addedElement: Element): string {
  const addedColor = ELEMENT_COLORS[addedElement];
  return blendColors(currentColor, addedColor, 0.3);
}

function blendColors(color1: string, color2: string, ratio: number): string {
  const hex = (x: string) => parseInt(x, 16);
  const r1 = hex(color1.slice(1, 3));
  const g1 = hex(color1.slice(3, 5));
  const b1 = hex(color1.slice(5, 7));
  const r2 = hex(color2.slice(1, 3));
  const g2 = hex(color2.slice(3, 5));
  const b2 = hex(color2.slice(5, 7));
  
  const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
  const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
  const b = Math.round(b1 * (1 - ratio) + b2 * ratio);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function calculateFlameHeight(baseHeight: number, airflow: number, elements: Element[]): number {
  const airFactor = 0.5 + airflow / 100;
  const elementBonus = elements.length * 10;
  return Math.min(200, Math.max(120, baseHeight * airFactor + elementBonus));
}

export function getSmokeColor(temperature: number): string {
  if (temperature < 33) {
    const t = temperature / 33;
    return `rgba(200, 200, 200, ${0.3 + t * 0.3})`;
  } else if (temperature < 66) {
    const t = (temperature - 33) / 33;
    const r = Math.round(255 * (1 - t * 0.3));
    const g = Math.round(150 * (1 - t * 0.5));
    const b = Math.round(50 * (1 - t));
    return `rgba(${r}, ${g}, ${b}, 0.6)`;
  } else {
    const t = (temperature - 66) / 34;
    const r = Math.round(50 * (1 - t * 0.8));
    const g = Math.round(150 + t * 105);
    const b = Math.round(200 + t * 55);
    return `rgba(${r}, ${g}, ${b}, 0.7)`;
  }
}

export function getParticleRate(temperature: number): number {
  return 40 + (temperature / 100) * 40;
}

export function createPill(
  ingredients: Herb[],
  temperature: number,
  airflow: number
): Pill | null {
  const elements = [...new Set(ingredients.map(i => i.element))];
  
  if (!hasGeneratingCombination(elements)) {
    return null;
  }
  
  const matchingRecipes = PILL_RECIPES.filter(recipe => {
    const recipeSet = new Set(recipe.elements);
    const elementSet = new Set(elements);
    if (recipeSet.size !== elementSet.size) return false;
    for (const el of recipeSet) {
      if (!elementSet.has(el)) return false;
    }
    return true;
  });
  
  if (matchingRecipes.length === 0) {
    return createRandomPill(elements, ingredients, temperature, airflow);
  }
  
  const recipe = matchingRecipes[Math.floor(Math.random() * matchingRecipes.length)];
  const name = recipe.names[Math.floor(Math.random() * recipe.names.length)];
  const effect = recipe.effects[Math.floor(Math.random() * recipe.effects.length)];
  const primaryElement = elements[0];
  
  return {
    id: generatePillId(),
    name,
    element: primaryElement,
    elements,
    effect,
    rarity: recipe.rarity,
    color: ELEMENT_COLORS[primaryElement],
    glowColor: RARITY_COLORS[recipe.rarity],
    ingredients: ingredients.map(i => i.name),
    fireTemp: Math.round(temperature),
    airFlow: Math.round(airflow)
  };
}

function createRandomPill(
  elements: Element[],
  ingredients: Herb[],
  temperature: number,
  airflow: number
): Pill {
  const rarities: PillRarity[] = ['common', 'uncommon', 'rare', 'epic'];
  const weights = [0.4, 0.3, 0.2, 0.1];
  let rand = Math.random();
  let rarity: PillRarity = 'common';
  for (let i = 0; i < rarities.length; i++) {
    rand -= weights[i];
    if (rand <= 0) {
      rarity = rarities[i];
      break;
    }
  }
  
  const effects = Object.keys(ELEMENT_COLORS);
  const effect = effects[Math.floor(Math.random() * effects.length)];
  const primaryElement = elements[Math.floor(Math.random() * elements.length)];
  const names = ['凝气丹', '聚灵丹', '培元丹', '固元丹', '淬体丹'];
  const name = names[Math.floor(Math.random() * names.length)];
  
  return {
    id: generatePillId(),
    name,
    element: primaryElement,
    elements,
    effect,
    rarity,
    color: ELEMENT_COLORS[primaryElement],
    glowColor: RARITY_COLORS[rarity],
    ingredients: ingredients.map(i => i.name),
    fireTemp: Math.round(temperature),
    airFlow: Math.round(airflow)
  };
}

export function getTemperatureFromFlameColor(color: string): number {
  const hex = color.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  
  if (b > 150) return 80 + Math.random() * 20;
  if (r > 200 && g < 100) return 40 + Math.random() * 30;
  return 10 + Math.random() * 30;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
