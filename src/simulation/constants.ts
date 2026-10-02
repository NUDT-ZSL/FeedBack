export const LIMITS = {
  RECIPE_TOTAL_MIN: 50,
  RECIPE_TOTAL_MAX: 500,
  PRESS_FORCE_MIN: 20,
  PRESS_FORCE_MAX: 80,
  MAX_INSPECT_POINTS: 5,
  DRY_TARGET: 100,
} as const;

export const RATES = {
  MIX_FULL_DURATION: 60,
  UNIFORMITY_JITTER: 0.1,
  DRY_PER_TICK_EFFECTIVE: 10,
  DRY_PER_TICK_INEFFECTIVE: 4,
  DEFECT_PENALTY_PER_POINT: 5,
} as const;

export const IDEAL_CONCENTRATION = { min: 0.08, max: 0.15 } as const;

export const RATING_THRESHOLDS = { 甲: 90, 乙: 75, 丙: 60 } as const;

export const DEFAULT_SEED = 20261003;

export const HISTORY_STORAGE_KEY = 'papermaking.history';
