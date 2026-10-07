import type { Spice, PerfumeType, EffectKey, PerfumeIngredient } from '../types';

export function calculateEffects(
  ingredients: { spice: Spice; percentage: number }[]
): Record<EffectKey, number> {
  const effects: Record<EffectKey, number> = {
    安神: 0,
    祛湿: 0,
    提神: 0,
    暖身: 0,
  };

  ingredients.forEach(({ spice, percentage }) => {
    const factor = percentage / 100;
    effects.安神 += spice.effects.安神 * factor;
    effects.祛湿 += spice.effects.祛湿 * factor;
    effects.提神 += spice.effects.提神 * factor;
    effects.暖身 += spice.effects.暖身 * factor;
  });

  return effects;
}

export function determinePerfumeType(
  ingredients: { spice: Spice; percentage: number }[]
): PerfumeType {
  if (ingredients.length === 0) return '线香';

  const categoryWeights: Record<string, number> = {};
  ingredients.forEach(({ spice, percentage }) => {
    categoryWeights[spice.category] =
      (categoryWeights[spice.category] || 0) + percentage;
  });

  const dominantCategory = Object.entries(categoryWeights).sort(
    (a, b) => b[1] - a[1]
  )[0][0];

  if (dominantCategory === '沉檀') return '线香';
  if (dominantCategory === '草本' || dominantCategory === '辛香') return '香饼';
  if (dominantCategory === '花香' || dominantCategory === '果香') return '香丸';

  return '线香';
}

export function normalizePercentages(
  ingredients: { spice: Spice; percentage: number }[],
  changedIndex: number,
  newValue: number
): PerfumeIngredient[] {
  if (ingredients.length === 0) return [];

  const result = ingredients.map((ing) => ({
    spiceId: ing.spice.id,
    percentage: ing.percentage,
  }));

  result[changedIndex].percentage = newValue;

  const total = result.reduce((sum, ing) => sum + ing.percentage, 0);
  const othersTotal = total - newValue;

  if (othersTotal > 0) {
    const scale = (100 - newValue) / othersTotal;
    result.forEach((ing, idx) => {
      if (idx !== changedIndex) {
        ing.percentage = Math.round(ing.percentage * scale);
      }
    });
  }

  const finalTotal = result.reduce((sum, ing) => sum + ing.percentage, 0);
  if (finalTotal !== 100 && result.length > 0) {
    result[result.length - 1].percentage += 100 - finalTotal;
  }

  return result;
}

export function generateEffectDescription(
  effects: Record<EffectKey, number>
): string {
  const descriptions: [EffectKey, number][] = Object.entries(effects) as [
    EffectKey,
    number
  ][];
  const sorted = descriptions.sort((a, b) => b[1] - a[1]);

  const primary = sorted[0];
  const secondary = sorted[1];

  const phrases: Record<EffectKey, string> = {
    安神: '安神助眠',
    祛湿: '祛湿除瘴',
    提神: '提神醒脑',
    暖身: '暖身驱寒',
  };

  if (primary[1] >= 60) {
    return phrases[primary[0]];
  }

  return `${phrases[primary[0]]} · ${phrases[secondary[0]]}`;
}

export function getDominantEffect(
  effects: Record<EffectKey, number>
): EffectKey {
  const entries = Object.entries(effects) as [EffectKey, number][];
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}
