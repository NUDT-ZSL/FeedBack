// Headless simulation core: the single source of truth shared by the
// browser-rendered Plant and the offline verification harness.
// This module must stay free of THREE.js / DOM dependencies so the whole
// growth derivation can be replayed outside a browser.

export interface PlantParams {
  light: number;
  water: number;
  temperature: number;
}

export type GrowthStage = 'seed' | 'sprout' | 'adult' | 'flowering';

export const STAGE_SPROUT_TIME = 5;
export const STAGE_ADULT_TIME = 15;
export const STAGE_FLOWERING_TIME = 30;

export const WILT_LIGHT_MIN = 15;
export const WILT_LIGHT_MAX = 90;
export const WILT_WATER_MIN = 15;
export const WILT_WATER_MAX = 90;
export const WILT_TEMP_MIN = 5;
export const WILT_TEMP_MAX = 35;

export const WILT_GROWTH_PAUSE_THRESHOLD = 0.9;
export const WILT_PROGRESS_RATE = 2;

export function isWiltCondition(params: PlantParams): boolean {
  const { light, water, temperature } = params;
  return (
    light < WILT_LIGHT_MIN || light > WILT_LIGHT_MAX ||
    water < WILT_WATER_MIN || water > WILT_WATER_MAX ||
    temperature < WILT_TEMP_MIN || temperature > WILT_TEMP_MAX
  );
}

export function computeGrowthRate(params: PlantParams): number {
  const { light, water } = params;
  const lightFactor = Math.sin((light / 100) * Math.PI);
  const waterFactor = Math.sin((water / 100) * Math.PI);
  const tempFactor =
    params.temperature >= 10 && params.temperature <= 32 ? 1 : 0.3;
  return 0.3 + 0.7 * lightFactor * waterFactor * tempFactor;
}

export function getStageForTime(growthTime: number): GrowthStage {
  if (growthTime < STAGE_SPROUT_TIME) return 'seed';
  if (growthTime < STAGE_ADULT_TIME) return 'sprout';
  if (growthTime < STAGE_FLOWERING_TIME) return 'adult';
  return 'flowering';
}

export function shouldKeepGrowing(
  isWilting: boolean,
  wiltProgress: number
): boolean {
  return !isWilting || wiltProgress < WILT_GROWTH_PAUSE_THRESHOLD;
}

export function stepWiltProgress(
  wiltProgress: number,
  isWilting: boolean,
  delta: number
): number {
  const target = isWilting ? 1 : 0;
  return wiltProgress + (target - wiltProgress) * delta * WILT_PROGRESS_RATE;
}

export function computeFloweringCountdown(
  growthTime: number,
  params: PlantParams
): number {
  const rate = Math.max(0.1, computeGrowthRate(params));
  return Math.max(0, STAGE_FLOWERING_TIME - growthTime) / rate;
}

export function formatCountdown(
  stage: GrowthStage,
  countdownSeconds: number
): string {
  if (stage === 'flowering') return '已开花 🌸';
  return `${Math.ceil(countdownSeconds)} 秒`;
}

export interface SimState {
  growthTime: number;
  stage: GrowthStage;
  isWilting: boolean;
  wiltProgress: number;
}

export function createSimState(): SimState {
  return {
    growthTime: 0,
    stage: 'seed',
    isWilting: false,
    wiltProgress: 0
  };
}

// Mirrors Plant.updateParams: only the wilting flag is affected by a
// parameter change; wiltProgress keeps smoothing during update ticks.
export function simApplyParams(state: SimState, params: PlantParams): SimState {
  if (isWiltCondition(params) && !state.isWilting) {
    state.isWilting = true;
  } else if (!isWiltCondition(params) && state.isWilting) {
    state.isWilting = false;
  }
  return state;
}

// Mirrors the state-affecting portion of Plant.update(delta), in the same
// operation order: grow -> advance stage -> smooth wilt progress.
export function simStep(
  state: SimState,
  params: PlantParams,
  delta: number
): SimState {
  if (shouldKeepGrowing(state.isWilting, state.wiltProgress)) {
    state.growthTime += delta * computeGrowthRate(params);
  }
  state.stage = getStageForTime(state.growthTime);
  state.wiltProgress = stepWiltProgress(
    state.wiltProgress,
    state.isWilting,
    delta
  );
  return state;
}

export function simReset(state: SimState): SimState {
  state.growthTime = 0;
  state.stage = 'seed';
  state.isWilting = false;
  state.wiltProgress = 0;
  return state;
}
