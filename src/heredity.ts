import type { OptimalEnvironment, PlantTraits } from './plants.js';

export type TraitKey = keyof PlantTraits;
export type RandomSource = () => number;

export const TRAIT_KEYS: TraitKey[] = ['color', 'shape', 'height', 'droughtResistance'];

const ENVIRONMENT_KEYS: (keyof OptimalEnvironment)[] = [
  'tempMin',
  'tempMax',
  'humidityMin',
  'humidityMax',
  'lightMin',
  'lightMax',
];

export function clampTraitValue(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function copyTraits(traits: PlantTraits): PlantTraits {
  return {
    color: traits.color,
    shape: traits.shape,
    height: traits.height,
    droughtResistance: traits.droughtResistance,
  };
}

function createEmptyTraits(): PlantTraits {
  return { color: 0, shape: 0, height: 0, droughtResistance: 0 };
}

export function selectHybridTraitKeys(
  random: RandomSource = Math.random
): { blend: TraitKey[]; inherit: TraitKey[] } {
  const numTraitsToBlend = Math.floor(random() * 2) + 2;
  const shuffled = [...TRAIT_KEYS].sort(() => random() - 0.5);

  return {
    blend: shuffled.slice(0, numTraitsToBlend),
    inherit: shuffled.slice(numTraitsToBlend),
  };
}

export function mixTraits(
  parent1Traits: PlantTraits,
  parent2Traits: PlantTraits,
  blendKeys: TraitKey[],
  inheritKeys: TraitKey[],
  random: RandomSource = Math.random
): PlantTraits {
  const result = createEmptyTraits();

  for (const key of blendKeys) {
    const midValue = (parent1Traits[key] + parent2Traits[key]) / 2;
    const offset = (random() - 0.5) * 40;
    result[key] = clampTraitValue(midValue + offset);
  }

  for (const key of inheritKeys) {
    const source = random() < 0.5 ? parent1Traits : parent2Traits;
    result[key] = source[key];
  }

  return result;
}

export function mutateSelfCrossTraits(
  traits: PlantTraits,
  random: RandomSource = Math.random
): PlantTraits {
  const result = copyTraits(traits);

  for (const key of TRAIT_KEYS) {
    if (random() < 0.05) {
      const mutation = (random() - 0.5) * 60;
      result[key] = clampTraitValue(result[key] + mutation);
    }
  }

  return result;
}

export function selectBackcrossTraits(
  plantTraits: PlantTraits,
  parentTraits: PlantTraits,
  random: RandomSource = Math.random
): PlantTraits {
  const result = createEmptyTraits();

  for (const key of TRAIT_KEYS) {
    result[key] = random() < 0.6 ? parentTraits[key] : plantTraits[key];
  }

  return result;
}

export function mergeOptimalEnvironments(
  firstEnvironment: OptimalEnvironment,
  secondEnvironment: OptimalEnvironment,
  secondParentWeight: number,
  shouldRound: boolean = true
): OptimalEnvironment {
  const firstParentWeight = 1 - secondParentWeight;

  return ENVIRONMENT_KEYS.reduce((result, key) => {
    const value =
      firstEnvironment[key] * firstParentWeight +
      secondEnvironment[key] * secondParentWeight;
    result[key] = shouldRound ? Math.round(value) : value;
    return result;
  }, createEmptyOptimalEnvironment());
}

function createEmptyOptimalEnvironment(): OptimalEnvironment {
  return {
    tempMin: 0,
    tempMax: 0,
    humidityMin: 0,
    humidityMax: 0,
    lightMin: 0,
    lightMax: 0,
  };
}
