import { LIMITS, RATES, IDEAL_CONCENTRATION, RATING_THRESHOLDS, DEFAULT_SEED } from './constants.ts';
import { createSeededRandom, type RandomSource } from './random.ts';
import {
  STAGE_ORDER,
  type BoundaryEvent,
  type FinalConclusion,
  type Intermediates,
  type Operation,
  type QualityRating,
  type Recipe,
  type StageId,
  type StepResult,
  type WorkshopState,
} from './types.ts';

export interface EngineOptions {
  random?: RandomSource;
  seed?: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function recipeTotal(recipe: Recipe): number {
  return recipe.bark + recipe.bamboo + recipe.water;
}

export function computeConcentration(recipe: Recipe): number {
  const total = recipeTotal(recipe);
  if (total <= 0) return 0;
  return (recipe.bark + recipe.bamboo) / total;
}

export function concentrationFit(concentration: number): number {
  const { min, max } = IDEAL_CONCENTRATION;
  if (concentration >= min && concentration <= max) return 1;
  const distance = concentration < min ? min - concentration : concentration - max;
  return clamp(1 - distance / min, 0, 1);
}

export function computeUniformity(duration: number, random: RandomSource): number {
  const base = clamp(duration / RATES.MIX_FULL_DURATION, 0, 1);
  const jitter = (random() - 0.5) * RATES.UNIFORMITY_JITTER;
  return round2(clamp(base + jitter, 0, 1));
}

export function validateRecipe(recipe: Recipe): BoundaryEvent[] {
  const events: BoundaryEvent[] = [];
  const total = recipeTotal(recipe);
  const amounts: Array<[string, number]> = [
    ['bark', recipe.bark],
    ['bamboo', recipe.bamboo],
    ['water', recipe.water],
  ];
  for (const [name, amount] of amounts) {
    if (amount < 0) {
      events.push({
        code: 'MATERIAL_AMOUNT_NEGATIVE',
        stage: 'mix',
        message: `原料 ${name} 用量为负（${amount}），配料无效`,
        detail: { material: name, amount },
      });
    }
  }
  if (total < LIMITS.RECIPE_TOTAL_MIN) {
    events.push({
      code: 'RECIPE_TOTAL_BELOW_MIN',
      stage: 'mix',
      message: `配料总量 ${total} 低于下限 ${LIMITS.RECIPE_TOTAL_MIN}，无法成浆`,
      detail: { total, min: LIMITS.RECIPE_TOTAL_MIN },
    });
  }
  if (total > LIMITS.RECIPE_TOTAL_MAX) {
    events.push({
      code: 'RECIPE_TOTAL_ABOVE_MAX',
      stage: 'mix',
      message: `配料总量 ${total} 超过上限 ${LIMITS.RECIPE_TOTAL_MAX}，料槽溢出`,
      detail: { total, max: LIMITS.RECIPE_TOTAL_MAX },
    });
  }
  return events;
}

function initialIntermediates(): Intermediates {
  return {
    concentration: null,
    uniformity: null,
    pressForce: null,
    pressEffective: false,
    dryness: 0,
    inspectScore: null,
  };
}

export function createInitialState(recipe: Recipe): WorkshopState {
  return {
    recipe: { ...recipe },
    completed: [],
    intermediates: initialIntermediates(),
    events: [],
    acceptedInspectPoints: 0,
    rejectedInspectPoints: 0,
    defects: 0,
    conclusion: null,
  };
}

function nextExpectedStage(completed: StageId[]): StageId | null {
  for (const stage of STAGE_ORDER) {
    if (!completed.includes(stage)) return stage;
  }
  return null;
}

function orderGuard(state: WorkshopState, stage: StageId): BoundaryEvent[] {
  const events: BoundaryEvent[] = [];
  const expected = nextExpectedStage(state.completed);
  if (state.completed.includes(stage)) {
    events.push({
      code: 'STAGE_REPEATED',
      stage,
      message: `环节「${stage}」已完成，重复操作被忽略`,
    });
  } else if (expected !== null && expected !== stage) {
    const inspectBeforeDry = expected === 'dry' && stage === 'inspect';
    if (!inspectBeforeDry) {
      events.push({
        code: 'STAGE_OUT_OF_ORDER',
        stage,
        message: `当前应进行「${expected}」，收到「${stage}」操作，已忽略`,
        detail: { expected, received: stage },
      });
    }
  }
  return events;
}

function baseQuality(inter: Intermediates): number {
  const concentration = inter.concentration ?? 0;
  const uniformity = inter.uniformity ?? 0;
  const fit = concentrationFit(concentration);
  const pressFactor = inter.pressEffective ? 1 : 0.6;
  const dryFactor = clamp(inter.dryness / LIMITS.DRY_TARGET, 0, 1);
  return 100 * fit * (0.5 + 0.5 * uniformity) * pressFactor * dryFactor;
}

function finalize(state: WorkshopState, recipeInvalid: boolean): FinalConclusion {
  const inter = state.intermediates;
  const reasons: string[] = [];
  for (const event of state.events) reasons.push(event.message);

  let rating: QualityRating;
  let valid = true;
  if (recipeInvalid) {
    rating = '次品';
    valid = false;
    reasons.push('配料越界，整批作废');
  } else if (inter.dryness < LIMITS.DRY_TARGET) {
    rating = '次品';
    valid = false;
    reasons.push(`干燥进度 ${inter.dryness}% 未完成即检验，判为次品`);
  } else {
    const score = inter.inspectScore ?? 0;
    if (score >= RATING_THRESHOLDS.甲) rating = '甲';
    else if (score >= RATING_THRESHOLDS.乙) rating = '乙';
    else if (score >= RATING_THRESHOLDS.丙) rating = '丙';
    else rating = '次品';
  }
  return { rating, score: inter.inspectScore, valid, reasons };
}

export class WorkshopEngine {
  private random: RandomSource;
  private state: WorkshopState;
  private recipeInvalid: boolean;

  constructor(recipe: Recipe, options: EngineOptions = {}) {
    this.random = options.random ?? createSeededRandom(options.seed ?? DEFAULT_SEED);
    this.state = createInitialState(recipe);
    this.recipeInvalid = false;
  }

  getState(): WorkshopState {
    return this.state;
  }

  apply(operation: Operation): StepResult {
    const stage = operation.type;
    const stepEvents: BoundaryEvent[] = [];

    const guardEvents = orderGuard(this.state, stage);
    if (guardEvents.length > 0) {
      stepEvents.push(...guardEvents);
      stepEvents.push({
        code: 'OPERATION_IGNORED',
        stage,
        message: `操作未生效：${JSON.stringify(operation)}`,
      });
      this.record(stepEvents);
      return { state: this.state, events: stepEvents };
    }

    switch (operation.type) {
      case 'mix':
        this.applyMix(operation.duration, stepEvents);
        break;
      case 'form':
        break;
      case 'press':
        this.applyPress(operation.force, stepEvents);
        break;
      case 'dry':
        this.applyDry(operation.ticks);
        break;
      case 'inspect':
        this.applyInspect(operation.points, stepEvents);
        break;
    }

    const dryIncomplete =
      stage === 'dry' && this.state.intermediates.dryness < LIMITS.DRY_TARGET;
    if (!dryIncomplete) {
      this.state.completed = [...this.state.completed, stage];
    }
    this.record(stepEvents);
    return { state: this.state, events: stepEvents };
  }

  private record(events: BoundaryEvent[]): void {
    this.state.events = [...this.state.events, ...events];
  }

  private applyMix(duration: number, events: BoundaryEvent[]): void {
    const recipeEvents = validateRecipe(this.state.recipe);
    events.push(...recipeEvents);
    this.recipeInvalid = recipeEvents.length > 0;
    const concentration = computeConcentration(this.state.recipe);
    const uniformity = computeUniformity(duration, this.random);
    this.state.intermediates = {
      ...this.state.intermediates,
      concentration: round2(concentration),
      uniformity,
    };
  }

  private applyPress(force: number, events: BoundaryEvent[]): void {
    let effective = true;
    if (force < LIMITS.PRESS_FORCE_MIN) {
      effective = false;
      events.push({
        code: 'PRESS_FORCE_BELOW_MIN',
        stage: 'press',
        message: `压榨力度 ${force} 低于下限 ${LIMITS.PRESS_FORCE_MIN}，压榨无效`,
        detail: { force, min: LIMITS.PRESS_FORCE_MIN },
      });
    } else if (force > LIMITS.PRESS_FORCE_MAX) {
      effective = false;
      events.push({
        code: 'PRESS_FORCE_ABOVE_MAX',
        stage: 'press',
        message: `压榨力度 ${force} 超过上限 ${LIMITS.PRESS_FORCE_MAX}，纸页压溃，压榨无效`,
        detail: { force, max: LIMITS.PRESS_FORCE_MAX },
      });
    }
    this.state.intermediates = {
      ...this.state.intermediates,
      pressForce: force,
      pressEffective: effective,
    };
  }

  private applyDry(ticks: number): void {
    const rate = this.state.intermediates.pressEffective
      ? RATES.DRY_PER_TICK_EFFECTIVE
      : RATES.DRY_PER_TICK_INEFFECTIVE;
    const before = this.state.intermediates.dryness;
    const after = clamp(before + ticks * rate, 0, LIMITS.DRY_TARGET);
    this.state.intermediates = { ...this.state.intermediates, dryness: after };
  }

  private applyInspect(points: number, events: BoundaryEvent[]): void {
    const inter = this.state.intermediates;
    if (inter.dryness < LIMITS.DRY_TARGET) {
      events.push({
        code: 'INSPECT_BEFORE_DRY_COMPLETE',
        stage: 'inspect',
        message: `干燥进度 ${inter.dryness}% 未完成即检验，结论无效`,
        detail: { dryness: inter.dryness, target: LIMITS.DRY_TARGET },
      });
    }

    const remaining = LIMITS.MAX_INSPECT_POINTS - this.state.acceptedInspectPoints;
    const accepted = clamp(points, 0, Math.max(0, remaining));
    const rejected = points - accepted;
    if (rejected > 0) {
      events.push({
        code: 'INSPECT_POINTS_EXCEEDED',
        stage: 'inspect',
        message: `检验点 ${points} 个超出剩余上限 ${Math.max(0, remaining)}，仅采纳 ${accepted} 个`,
        detail: { requested: points, accepted, limit: LIMITS.MAX_INSPECT_POINTS },
      });
    }
    this.state.acceptedInspectPoints += accepted;
    this.state.rejectedInspectPoints += rejected;

    const quality = baseQuality(inter);
    const defectProbability = clamp(1 - quality / 100, 0, 1);
    let defects = 0;
    for (let i = 0; i < accepted; i += 1) {
      if (this.random() < defectProbability) defects += 1;
    }
    this.state.defects += defects;

    const totalAccepted = this.state.acceptedInspectPoints;
    const penalty =
      totalAccepted > 0
        ? (this.state.defects * 100) / totalAccepted + this.state.defects * RATES.DEFECT_PENALTY_PER_POINT
        : 0;
    const score = totalAccepted > 0 ? round2(clamp(quality - penalty, 0, 100)) : 0;
    this.state.intermediates = { ...this.state.intermediates, inspectScore: score };
    this.state.conclusion = finalize(this.state, this.recipeInvalid);
  }
}

export function runSequence(
  recipe: Recipe,
  operations: Operation[],
  options: EngineOptions = {},
): WorkshopState {
  const engine = new WorkshopEngine(recipe, options);
  for (const operation of operations) engine.apply(operation);
  return engine.getState();
}
