import type { Element, Herb, Pill, PillRarity } from '../types.ts';
import {
  ELEMENT_COLORS,
  ELEMENT_GENERATES,
  ELEMENT_NAMES,
  ELEMENT_OVERCOMES,
  PILL_RECIPES,
  RARITY_COLORS
} from '../constants.ts';
import type {
  ConflictRecord,
  FurnaceStatus,
  IngredientRecord,
  PillVerdict,
  Rng
} from './model.ts';
import { BASE_FLAME_COLOR, BASE_FLAME_HEIGHT } from './model.ts';

export function blendColors(color1: string, color2: string, ratio: number): string {
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);
  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);

  const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
  const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
  const b = Math.round(b1 * (1 - ratio) + b2 * ratio);

  return `#${r.toString(16).padStart(2, '0')}${g
    .toString(16)
    .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function mixFireColor(currentColor: string, addedElement: Element): string {
  return blendColors(currentColor, ELEMENT_COLORS[addedElement], 0.3);
}

export function calculateFlameHeight(
  baseHeight: number,
  airflow: number,
  elements: Element[]
): number {
  const airFactor = 0.5 + airflow / 100;
  const elementBonus = elements.length * 10;
  return Math.min(200, Math.max(120, baseHeight * airFactor + elementBonus));
}

export function deriveElements(ingredients: IngredientRecord[]): Element[] {
  return [...new Set(ingredients.map((record) => record.herb.element))];
}

export function deriveFlameColor(ingredients: IngredientRecord[]): string {
  return ingredients.reduce(
    (color, record) => mixFireColor(color, record.herb.element),
    BASE_FLAME_COLOR
  );
}

export function deriveFlameHeight(airflow: number, ingredients: IngredientRecord[]): number {
  return calculateFlameHeight(BASE_FLAME_HEIGHT, airflow, deriveElements(ingredients));
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

export function getGeneratingPairs(elements: Element[]): Array<[Element, Element]> {
  const uniqueElements = [...new Set(elements)];
  const pairs: Array<[Element, Element]> = [];
  for (const source of uniqueElements) {
    const target = ELEMENT_GENERATES[source];
    if (uniqueElements.includes(target)) {
      pairs.push([source, target]);
    }
  }
  return pairs;
}

export function getBeamElements(elements: Element[]): (Element | null)[] {
  const result: (Element | null)[] = new Array(9).fill(null);
  const generating: Element[] = [];
  for (const [source, target] of getGeneratingPairs(elements)) {
    if (!generating.includes(source)) generating.push(source);
    if (!generating.includes(target)) generating.push(target);
  }
  for (let i = 0; i < generating.length && i < 9; i++) {
    result[i] = generating[i];
  }
  return result;
}

export function areRestraining(a: Element, b: Element): boolean {
  return ELEMENT_OVERCOMES[a] === b || ELEMENT_OVERCOMES[b] === a;
}

export function describeRestraint(a: Element, b: Element): string {
  if (ELEMENT_OVERCOMES[a] === b) return `${ELEMENT_NAMES[a]}克${ELEMENT_NAMES[b]}`;
  return `${ELEMENT_NAMES[b]}克${ELEMENT_NAMES[a]}`;
}

export interface PairConflict {
  existing: IngredientRecord;
  incoming: IngredientRecord;
}

export function findPairConflicts(ingredients: IngredientRecord[]): {
  duplicates: PairConflict[];
  restraints: PairConflict[];
} {
  const duplicates: PairConflict[] = [];
  const restraints: PairConflict[] = [];
  for (let j = 0; j < ingredients.length; j++) {
    for (let i = 0; i < j; i++) {
      const earlier = ingredients[i];
      const later = ingredients[j];
      if (earlier.herb.element === later.herb.element) {
        duplicates.push({ existing: earlier, incoming: later });
      } else if (areRestraining(earlier.herb.element, later.herb.element)) {
        restraints.push({ existing: earlier, incoming: later });
      }
    }
  }
  return { duplicates, restraints };
}

export function conflictActiveKeys(ingredients: IngredientRecord[]): Set<string> {
  const { duplicates, restraints } = findPairConflicts(ingredients);
  const keys = new Set<string>();
  for (const pair of [...duplicates, ...restraints]) {
    keys.add(`${pair.existing.seq}:${pair.incoming.seq}`);
  }
  return keys;
}

export function resolveStatus(
  ingredients: IngredientRecord[],
  activeConflicts: ConflictRecord[]
): FurnaceStatus {
  if (activeConflicts.some((conflict) => conflict.kind === 'restrain')) {
    return 'exploded';
  }
  if (activeConflicts.some((conflict) => conflict.kind === 'duplicate')) {
    return 'conflicted';
  }
  return ingredients.length > 0 ? 'refining' : 'idle';
}

function pickWeightedRarity(rng: Rng): PillRarity {
  const rarities: PillRarity[] = ['common', 'uncommon', 'rare', 'epic'];
  const weights = [0.4, 0.3, 0.2, 0.1];
  let roll = rng();
  for (let i = 0; i < rarities.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return rarities[i];
  }
  return 'common';
}

export function createPillWithRng(
  id: string,
  ingredients: Herb[],
  temperature: number,
  airflow: number,
  rng: Rng
): Pill | null {
  const elements = [...new Set(ingredients.map((item) => item.element))];
  if (!hasGeneratingCombination(elements)) return null;

  const herbNames = ingredients.map((item) => item.name);
  const matchingRecipes = PILL_RECIPES.filter((recipe) => {
    if (recipe.elements.length !== elements.length) return false;
    return recipe.elements.every((element) => elements.includes(element));
  });

  if (matchingRecipes.length === 0) {
    const rarity = pickWeightedRarity(rng);
    const effectElements = Object.keys(ELEMENT_COLORS);
    const effect = effectElements[Math.floor(rng() * effectElements.length)];
    const primaryElement = elements[Math.floor(rng() * elements.length)];
    const names = ['凝气丹', '聚灵丹', '培元丹', '固元丹', '淬体丹'];
    return {
      id,
      name: names[Math.floor(rng() * names.length)],
      element: primaryElement,
      elements,
      effect,
      rarity,
      color: ELEMENT_COLORS[primaryElement],
      glowColor: RARITY_COLORS[rarity],
      ingredients: herbNames,
      fireTemp: Math.round(temperature),
      airFlow: Math.round(airflow)
    };
  }

  const recipe = matchingRecipes[Math.floor(rng() * matchingRecipes.length)];
  const name = recipe.names[Math.floor(rng() * recipe.names.length)];
  const effect = recipe.effects[Math.floor(rng() * recipe.effects.length)];
  const primaryElement = elements[0];

  return {
    id,
    name,
    element: primaryElement,
    elements,
    effect,
    rarity: recipe.rarity,
    color: ELEMENT_COLORS[primaryElement],
    glowColor: RARITY_COLORS[recipe.rarity],
    ingredients: herbNames,
    fireTemp: Math.round(temperature),
    airFlow: Math.round(airflow)
  };
}

export function noVerdict(ingredients: IngredientRecord[]): PillVerdict {
  if (ingredients.length === 0) {
    return {
      outcome: 'none',
      pill: null,
      reason: '炉膛空净，尚无药材入炉。',
      basis: []
    };
  }
  if (ingredients.length < 2) {
    return {
      outcome: 'none',
      pill: null,
      reason: `仅投入一味「${ingredients[0].herb.name}」，孤药不成丹，至少需两味相生药材。`,
      basis: [`投料 ${ingredients[0].seq} 号：${ingredients[0].herb.name}（${
        ELEMENT_NAMES[ingredients[0].herb.element]
      }）`]
    };
  }
  const present = deriveElements(ingredients)
    .map((element) => ELEMENT_NAMES[element])
    .join('、');
  return {
    outcome: 'none',
    pill: null,
    reason: `炉中五行 ${present} 之间未形成相生之势，继续加料或回退重配。`,
    basis: [`当前五行：${present}`, '相生判定：未命中']
  };
}
