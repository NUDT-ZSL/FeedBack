import type { MaterialType, PaperStage, QualityGrade } from '../types';

export type { MaterialType } from '../types';

/**
 * 造纸作坊纯推演层。
 *
 * 该模块不依赖 DOM、计时器与全局随机数，所有判定与流程推进均为纯函数。
 * 随机因素通过 RandomSource 注入：交互层传入 Math.random 保持既有表现，
 * 批量推演传入 createSeededRandom 生成的种子随机源以保证完全可复现。
 */

export type RandomSource = () => number;

export const MATERIAL_MIN = 0;
export const MATERIAL_MAX = 50;
export const CONCENTRATION_MIN = 0;
export const CONCENTRATION_MAX = 100;
export const OPTIMAL_CONCENTRATION = 50;
export const PRESS_LEVEL_REASONABLE_MIN = 70;
export const PRESS_LEVEL_REASONABLE_MAX = 90;
export const PRESS_RESULT_DRYNESS = 30;
export const DRYNESS_COMPLETE = 100;
export const MAX_INSPECTION_POINTS = 10;

export const MATERIAL_TYPES: MaterialType[] = ['chuPi', 'sangPi', 'maXianWei'];

export const DEFAULT_MATERIALS: Record<MaterialType, number> = {
  chuPi: 20,
  sangPi: 20,
  maXianWei: 10,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 确定性种子随机源（mulberry32），同一种子产生完全一致的序列。 */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function calculateConcentration(materials: Record<MaterialType, number>): number {
  const total = materials.chuPi + materials.sangPi + materials.maXianWei;
  return clamp(total, CONCENTRATION_MIN, CONCENTRATION_MAX);
}

export function calculateUniformity(concentration: number, random: RandomSource): number {
  const deviation = Math.abs(concentration - OPTIMAL_CONCENTRATION);
  const baseScore = Math.max(0, 100 - deviation * 1.5);
  const randomFactor = random() * 10 - 5;
  return clamp(baseScore + randomFactor, 0, 100);
}

/** 压榨力度抽取：基准区间 [70, 95)，是否落入合理区间由推演层判定并上报。 */
export function drawPressLevel(random: RandomSource): number {
  return 70 + random() * 25;
}

export function calculateDryingTime(pressLevel: number): number {
  const baseTime = 4000;
  const reduction = pressLevel * 20;
  return Math.max(2000, baseTime - reduction);
}

export function calculateBreakProbability(uniformity: number, dryness: number): number {
  const uniformityFactor = (100 - uniformity) * 0.3;
  const drynessFactor = dryness > 90 ? (dryness - 90) * 2 : 0;
  return Math.min(30, uniformityFactor + drynessFactor);
}

export function gradeForScore(score: number): QualityGrade {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'medium';
  return 'poor';
}

export function calculateQualityScore(
  concentration: number,
  uniformity: number,
  dryness: number,
  pressLevel: number,
  inspectionPoints: number
): { score: number; grade: QualityGrade } {
  const concentrationScore = 100 - Math.abs(concentration - OPTIMAL_CONCENTRATION) * 1.2;
  const uniformityScore = uniformity;
  const drynessScore = dryness >= 95 ? 100 : dryness * 1.05;
  const pressScore =
    pressLevel >= PRESS_LEVEL_REASONABLE_MIN && pressLevel <= PRESS_LEVEL_REASONABLE_MAX
      ? 100
      : 100 - Math.abs(pressLevel - 80) * 1.5;
  const inspectionBonus = inspectionPoints * 2;

  const totalScore =
    concentrationScore * 0.25 +
    uniformityScore * 0.3 +
    drynessScore * 0.2 +
    pressScore * 0.15 +
    inspectionBonus;

  const score = clamp(Math.round(totalScore), 0, 100);
  return { score, grade: gradeForScore(score) };
}

export type SimulationIssueCode =
  | 'MATERIAL_AMOUNT_CLAMPED'
  | 'MATERIAL_TOTAL_OUT_OF_RANGE'
  | 'OPERATION_OUT_OF_ORDER'
  | 'PRESS_LEVEL_OUT_OF_RANGE'
  | 'INSPECT_BEFORE_DRIED'
  | 'DRYNESS_NOT_COMPLETE'
  | 'INSPECTION_POINTS_EXCEEDED';

export interface SimulationIssue {
  code: SimulationIssueCode;
  message: string;
}

export type WorkshopOperation =
  | { type: 'addMaterial'; material: MaterialType; amount: number }
  | { type: 'scoop' }
  | { type: 'press'; pressLevel?: number }
  | { type: 'advanceDrying'; drynessDelta?: number }
  | { type: 'inspect' }
  | { type: 'finalize' };

export interface SimulationState {
  stage: PaperStage;
  materials: Record<MaterialType, number>;
  concentration: number;
  uniformity: number | null;
  pressLevel: number | null;
  dryness: number;
  inspectionPoints: number;
  result: { score: number; grade: QualityGrade } | null;
}

export interface SimulationStep {
  operation: WorkshopOperation;
  applied: boolean;
  state: SimulationState;
  issues: SimulationIssue[];
}

export interface SimulationOptions {
  random?: RandomSource;
  idGenerator?: () => string;
  initialMaterials?: Record<MaterialType, number>;
}

export interface WorkshopSimulation {
  dispatch(operation: WorkshopOperation): SimulationStep;
  getState(): SimulationState;
  getIssues(): SimulationIssue[];
  getPaperId(): string | null;
}

interface InternalState extends SimulationState {
  paperId: string | null;
}

function snapshot(state: InternalState): SimulationState {
  return {
    stage: state.stage,
    materials: { ...state.materials },
    concentration: state.concentration,
    uniformity: state.uniformity,
    pressLevel: state.pressLevel,
    dryness: state.dryness,
    inspectionPoints: state.inspectionPoints,
    result: state.result ? { ...state.result } : null,
  };
}

export function createWorkshopSimulation(options: SimulationOptions = {}): WorkshopSimulation {
  const random = options.random ?? createSeededRandom(1);
  const idGenerator = options.idGenerator ?? (() => 'paper-1');

  const state: InternalState = {
    stage: 'pulp',
    materials: { ...(options.initialMaterials ?? DEFAULT_MATERIALS) },
    concentration: 0,
    uniformity: null,
    pressLevel: null,
    dryness: 0,
    inspectionPoints: 0,
    result: null,
    paperId: null,
  };
  state.concentration = calculateConcentration(state.materials);

  const allIssues: SimulationIssue[] = [];

  const dispatch = (operation: WorkshopOperation): SimulationStep => {
    const issues: SimulationIssue[] = [];
    let applied = true;

    const report = (code: SimulationIssueCode, message: string) => {
      issues.push({ code, message });
    };

    switch (operation.type) {
      case 'addMaterial': {
        if (state.stage !== 'pulp') {
          applied = false;
          report('OPERATION_OUT_OF_ORDER', `当前阶段 ${state.stage} 不允许调整配料`);
          break;
        }
        const before = state.materials[operation.material];
        const after = clamp(before + operation.amount, MATERIAL_MIN, MATERIAL_MAX);
        if (after !== before + operation.amount) {
          report(
            'MATERIAL_AMOUNT_CLAMPED',
            `原料 ${operation.material} 目标值 ${before + operation.amount} 越界，已收敛至 ${after}`
          );
        }
        state.materials[operation.material] = after;
        const total = MATERIAL_TYPES.reduce((sum, key) => sum + state.materials[key], 0);
        if (total > CONCENTRATION_MAX || total < CONCENTRATION_MIN) {
          report(
            'MATERIAL_TOTAL_OUT_OF_RANGE',
            `配料总量 ${total} 越界，浓度已收敛至 ${CONCENTRATION_MAX}`
          );
        }
        state.concentration = calculateConcentration(state.materials);
        break;
      }
      case 'scoop': {
        if (state.stage !== 'pulp') {
          applied = false;
          report('OPERATION_OUT_OF_ORDER', `当前阶段 ${state.stage} 不允许抄纸`);
          break;
        }
        state.uniformity = calculateUniformity(state.concentration, random);
        state.paperId = idGenerator();
        state.stage = 'wet';
        break;
      }
      case 'press': {
        if (state.stage !== 'wet') {
          applied = false;
          report('OPERATION_OUT_OF_ORDER', `当前阶段 ${state.stage} 不允许压榨`);
          break;
        }
        state.pressLevel = operation.pressLevel ?? drawPressLevel(random);
        state.dryness = PRESS_RESULT_DRYNESS;
        if (
          state.pressLevel < PRESS_LEVEL_REASONABLE_MIN ||
          state.pressLevel > PRESS_LEVEL_REASONABLE_MAX
        ) {
          report(
            'PRESS_LEVEL_OUT_OF_RANGE',
            `压榨力度 ${round2(state.pressLevel)} 落在合理区间 ` +
              `[${PRESS_LEVEL_REASONABLE_MIN}, ${PRESS_LEVEL_REASONABLE_MAX}] 之外`
          );
        }
        state.stage = 'pressed';
        break;
      }
      case 'advanceDrying': {
        if (state.stage !== 'pressed' && state.stage !== 'drying') {
          applied = false;
          report('OPERATION_OUT_OF_ORDER', `当前阶段 ${state.stage} 不允许晾晒`);
          break;
        }
        const delta = operation.drynessDelta ?? DRYNESS_COMPLETE;
        state.dryness = clamp(state.dryness + delta, 0, DRYNESS_COMPLETE);
        state.stage = state.dryness >= DRYNESS_COMPLETE ? 'dried' : 'drying';
        break;
      }
      case 'inspect': {
        if (state.stage !== 'dried' && state.stage !== 'inspecting') {
          applied = false;
          report(
            'INSPECT_BEFORE_DRIED',
            `干燥进度 ${round2(state.dryness)}% 未完成（阶段 ${state.stage}），检验被拒绝`
          );
          break;
        }
        if (state.inspectionPoints >= MAX_INSPECTION_POINTS) {
          applied = false;
          report(
            'INSPECTION_POINTS_EXCEEDED',
            `检验点已达上限 ${MAX_INSPECTION_POINTS}，本次检验不计入`
          );
          break;
        }
        state.inspectionPoints += 1;
        state.stage = 'inspecting';
        break;
      }
      case 'finalize': {
        if (state.uniformity === null || state.pressLevel === null) {
          applied = false;
          report('OPERATION_OUT_OF_ORDER', `当前阶段 ${state.stage} 尚未完成抄纸与压榨，无法定级`);
          break;
        }
        if (state.dryness < DRYNESS_COMPLETE) {
          report(
            'DRYNESS_NOT_COMPLETE',
            `干燥进度 ${round2(state.dryness)}% 未完成即检验定级，结论按当前干燥度计算`
          );
        }
        state.result = calculateQualityScore(
          state.concentration,
          state.uniformity,
          state.dryness,
          state.pressLevel,
          state.inspectionPoints
        );
        state.stage = 'done';
        break;
      }
    }

    allIssues.push(...issues);
    return { operation, applied, state: snapshot(state), issues };
  };

  return {
    dispatch,
    getState: () => snapshot(state),
    getIssues: () => allIssues.map((issue) => ({ ...issue })),
    getPaperId: () => state.paperId,
  };
}

export interface SimulationRun {
  steps: SimulationStep[];
  finalState: SimulationState;
  issues: SimulationIssue[];
}

/** 顺序执行一组操作并返回完整推演轨迹，同一输入重复执行结果完全一致。 */
export function runSimulation(
  operations: WorkshopOperation[],
  options: SimulationOptions = {}
): SimulationRun {
  const simulation = createWorkshopSimulation(options);
  const steps = operations.map((operation) => simulation.dispatch(operation));
  return {
    steps,
    finalState: simulation.getState(),
    issues: simulation.getIssues(),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
