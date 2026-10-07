import { mixColors, getDominantColor } from '../utils/color.ts';
import type { RecipeItem, SmokeParticle } from '../types/index.ts';

export const MAX_TOTAL_GRAMS = 10;
export const MAX_ITEM_GRAMS = 5;
export const GRIND_FULL = 100;
export const BURN_TICKS = 50;
const PARTICLE_TTL_TICKS = 30;
const MAX_PARTICLES = 200;
const TICK_MS = 100;

export type Phase = 'mixing' | 'synthesized' | 'placed' | 'burning' | 'burnt';

export interface Incense {
  color: string;
  recipe: RecipeItem[];
  grindLevel: number;
}

export interface IncenseState {
  phase: Phase;
  currentRecipe: RecipeItem[];
  grindLevel: number;
  incense: Incense | null;
  isBurning: boolean;
  burntime: number;
  aromaScore: number;
  smokeParticles: SmokeParticle[];
}

export interface MachineContext {
  now: number;
  random: () => number;
  nextParticleId: () => number;
}

export type RejectReason =
  | 'LOCKED_INGREDIENT'
  | 'ITEM_CAP_REACHED'
  | 'TOTAL_CAP_REACHED'
  | 'NEED_RECIPE'
  | 'GRIND_NOT_FULL'
  | 'NO_INCENSE'
  | 'ALREADY_PLACED'
  | 'NOT_PLACED'
  | 'ALREADY_BURNING'
  | 'NOT_BURNING';

export interface StepResult {
  state: IncenseState;
  accepted: boolean;
  rejected?: RejectReason;
}

export const DEFAULT_INCENSE_COLOR = '#8b7355';

export function createInitialState(): IncenseState {
  return {
    phase: 'mixing',
    currentRecipe: [],
    grindLevel: 0,
    incense: null,
    isBurning: false,
    burntime: 0,
    aromaScore: 0,
    smokeParticles: [],
  };
}

export function defaultContext(
  overrides: Partial<MachineContext> = {},
  startId = 0,
): MachineContext {
  let id = startId;
  return {
    now: Date.now(),
    random: Math.random,
    nextParticleId: () => id++,
    ...overrides,
  };
}

const reject = (state: IncenseState, reason: RejectReason): StepResult => ({
  state,
  accepted: false,
  rejected: reason,
});

const accept = (state: IncenseState): StepResult => ({ state, accepted: true });

export function totalGrams(recipe: RecipeItem[]): number {
  return recipe.reduce((sum, item) => sum + item.grams, 0);
}

export function addIngredient(
  prev: IncenseState,
  name: string,
  grams: number,
  color: string,
): StepResult {
  if (prev.phase !== 'mixing') {
    return reject(prev, 'LOCKED_INGREDIENT');
  }
  if (grams <= 0) {
    return reject(prev, 'ITEM_CAP_REACHED');
  }

  const total = totalGrams(prev.currentRecipe);
  const existing = prev.currentRecipe.find(item => item.name === name);
  const currentItemGrams = existing ? existing.grams : 0;

  const allowed = Math.max(
    0,
    Math.min(grams, MAX_ITEM_GRAMS - currentItemGrams, MAX_TOTAL_GRAMS - total),
  );
  if (allowed <= 0) {
    if (currentItemGrams >= MAX_ITEM_GRAMS) return reject(prev, 'ITEM_CAP_REACHED');
    return reject(prev, 'TOTAL_CAP_REACHED');
  }

  const recipe = existing
    ? prev.currentRecipe.map(item =>
        item.name === name ? { ...item, grams: item.grams + allowed } : item,
      )
    : [...prev.currentRecipe, { name, grams: allowed, color }];

  return accept({ ...prev, currentRecipe: recipe });
}

export function addGrind(prev: IncenseState, delta: number): StepResult {
  if (prev.phase !== 'mixing' || prev.currentRecipe.length === 0) {
    return reject(prev, 'NEED_RECIPE');
  }
  const next = Math.min(GRIND_FULL, Math.max(0, prev.grindLevel + delta));
  if (next === prev.grindLevel) {
    return reject(prev, 'GRIND_NOT_FULL');
  }
  return accept({ ...prev, grindLevel: next });
}

export function createIncense(prev: IncenseState): StepResult {
  if (prev.phase !== 'mixing') {
    return reject(prev, 'NO_INCENSE');
  }
  if (prev.currentRecipe.length === 0) return reject(prev, 'NEED_RECIPE');
  if (prev.grindLevel < GRIND_FULL) return reject(prev, 'GRIND_NOT_FULL');

  const recipe = prev.currentRecipe.map(item => ({ ...item }));
  const incense: Incense = {
    color: mixColors(recipe.map(item => ({ color: item.color, weight: item.grams }))),
    recipe,
    grindLevel: prev.grindLevel,
  };

  return accept({
    ...prev,
    phase: 'synthesized',
    currentRecipe: [],
    grindLevel: 0,
    incense,
  });
}

export function placeIncenseOnCenser(prev: IncenseState): StepResult {
  if (!prev.incense) return reject(prev, 'NO_INCENSE');
  if (prev.phase !== 'synthesized') return reject(prev, 'ALREADY_PLACED');
  return accept({ ...prev, phase: 'placed' });
}

export function ignite(prev: IncenseState): StepResult {
  if (!prev.incense) return reject(prev, 'NO_INCENSE');
  if (prev.phase === 'synthesized') return reject(prev, 'NOT_PLACED');
  if (prev.phase !== 'placed') return reject(prev, 'ALREADY_BURNING');
  return accept({
    ...prev,
    phase: 'burning',
    isBurning: true,
    burntime: 0,
    aromaScore: 0,
    smokeParticles: [],
  });
}

export function tick(prev: IncenseState, ctx: MachineContext): StepResult {
  if (prev.phase !== 'burning' || !prev.incense) {
    return reject(prev, 'NOT_BURNING');
  }

  const dominantColor = getDominantColor(
    prev.incense.recipe.map(item => ({ color: item.color, weight: item.grams })),
  );

  let particles = [...prev.smokeParticles];
  const spawnedAt = ctx.now + prev.burntime * TICK_MS;

  if (prev.burntime < BURN_TICKS && prev.burntime % 5 === 0) {
    const count = 5 + Math.floor(ctx.random() * 4);
    for (let i = 0; i < count; i++) {
      particles.push({
        id: ctx.nextParticleId(),
        x: 50 + (ctx.random() - 0.5) * 20,
        y: 0,
        diameter: 6 + ctx.random() * 2,
        opacity: 0.85 + ctx.random() * 0.1,
        velocityX: (ctx.random() - 0.5) * 2,
        velocityY: -1.5 - ctx.random() * 1.5,
        createdAt: spawnedAt,
        color: dominantColor,
      });
    }
    if (particles.length > MAX_PARTICLES) {
      particles = particles.slice(-MAX_PARTICLES);
    }
  }

  const burntime = prev.burntime + 1;
  const nowMs = ctx.now + burntime * TICK_MS;
  const aromaScore = burntime % 10 === 0 ? Math.min(100, prev.aromaScore + 2) : prev.aromaScore;

  particles = particles
    .map(particle => {
      const lifeProgress = Math.min(
        1,
        Math.max(0, (nowMs - particle.createdAt) / (PARTICLE_TTL_TICKS * TICK_MS)),
      );
      return {
        ...particle,
        x: particle.x + particle.velocityX * 0.5 + (ctx.random() - 0.5) * 3,
        y: particle.y + particle.velocityY + (ctx.random() - 0.5) * 1 - 1,
        diameter: Math.max(0, particle.diameter - lifeProgress * 5),
        opacity: Math.max(0, particle.opacity - lifeProgress * 0.9),
      };
    })
    .filter(particle => particle.opacity > 0.05 && particle.diameter > 0.5);

  const burning = burntime < BURN_TICKS;

  return accept({
    ...prev,
    phase: burning ? 'burning' : 'burnt',
    isBurning: burning,
    burntime,
    aromaScore,
    smokeParticles: burning ? particles : [],
  });
}

export function reset(): IncenseState {
  return createInitialState();
}

export interface InvariantViolation {
  code: string;
  detail: string;
}

export function checkInvariants(state: IncenseState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const total = totalGrams(state.currentRecipe);

  if (state.currentRecipe.some(item => item.grams <= 0 || item.grams > MAX_ITEM_GRAMS)) {
    violations.push({ code: 'ITEM_GRAMS', detail: '存在单料克数超出 (0,5] 范围' });
  }
  if (total > MAX_TOTAL_GRAMS) {
    violations.push({ code: 'TOTAL_GRAMS', detail: `配方总重 ${total}g 超过 10g` });
  }
  if (state.grindLevel < 0 || state.grindLevel > GRIND_FULL) {
    violations.push({ code: 'GRIND_RANGE', detail: `研磨进度越界: ${state.grindLevel}` });
  }

  const hasIncense = state.incense !== null;
  const onCenser = state.phase === 'placed' || state.phase === 'burning' || state.phase === 'burnt';

  if ((state.phase !== 'mixing') !== hasIncense) {
    violations.push({ code: 'PHASE_INCENSE', detail: '阶段与香品存在性不一致' });
  }
  if (onCenser && !hasIncense) {
    violations.push({ code: 'CENSER_WITHOUT_INCENSE', detail: '香炉上有香但香品不存在' });
  }
  if (state.isBurning !== (state.phase === 'burning')) {
    violations.push({ code: 'IS_BURNING', detail: 'isBurning 与阶段不一致' });
  }
  if (state.phase === 'mixing' && (state.burntime !== 0 || state.aromaScore !== 0)) {
    violations.push({ code: 'STALE_BURN', detail: '非燃烧阶段残留计时或评分' });
  }
  if (!state.isBurning && state.smokeParticles.length !== 0) {
    violations.push({ code: 'STALE_PARTICLES', detail: '未燃烧时残留烟雾粒子' });
  }
  if (state.phase === 'burning' && (state.burntime < 0 || state.burntime > BURN_TICKS)) {
    violations.push({ code: 'BURNTIME_RANGE', detail: `燃烧计时越界: ${state.burntime}` });
  }
  if (hasIncense && state.incense) {
    const expectedColor = mixColors(
      state.incense.recipe.map(item => ({ color: item.color, weight: item.grams })),
    );
    if (state.incense.color !== expectedColor) {
      violations.push({
        code: 'INCENSE_COLOR',
        detail: `香品颜色 ${state.incense.color} 与配方快照推算颜色 ${expectedColor} 不一致`,
      });
    }
    const snapTotal = totalGrams(state.incense.recipe);
    if (snapTotal <= 0 || snapTotal > MAX_TOTAL_GRAMS) {
      violations.push({ code: 'SNAPSHOT_GRAMS', detail: '香品配方快照重量不合法' });
    }
  }
  if (state.phase === 'mixing' && state.grindLevel > 0 && state.currentRecipe.length === 0) {
    violations.push({ code: 'GRIND_WITHOUT_RECIPE', detail: '无配方时存在研磨进度' });
  }

  return violations;
}
