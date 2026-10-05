import type { MaterialType, QualityGrade } from '../types';
import type {
  Rng,
  SimOperation,
  SimOptions,
  SimOutcome,
  SimState,
  SimTraceEntry,
  SimViolation,
  SimPaper,
} from './types';

export const MATERIAL_MIN = 0;
export const MATERIAL_MAX = 50;
export const CONCENTRATION_MIN = 0;
export const CONCENTRATION_MAX = 100;
export const PRESS_MIN = 70;
export const PRESS_MAX = 90;
export const DRY_DONE_THRESHOLD = 100;
export const MAX_INSPECTION_POINTS = 10;
export const POST_PRESS_DRYNESS = 30;
export const OPTIMAL_CONCENTRATION = 50;

export const DEFAULT_MATERIALS: Record<MaterialType, number> = {
  chuPi: 20,
  sangPi: 20,
  maXianWei: 10,
};

export const unitRng: Rng = () => 0;

/** 确定性伪随机数发生器（mulberry32），同一 seed 永远产生同一序列 */
export function createSeededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createInitialState(
  materials: Record<MaterialType, number> = { ...DEFAULT_MATERIALS }
): SimState {
  return {
    materials: { ...materials },
    concentration: calculateConcentration(materials),
    paper: null,
    result: null,
  };
}

export function calculateConcentration(
  materials: Record<MaterialType, number>
): number {
  const total =
    materials.chuPi + materials.sangPi + materials.maXianWei;
  return clamp(total, CONCENTRATION_MIN, CONCENTRATION_MAX);
}

/** 均匀度 = 偏离最优浓度的扣减 + 外部注入的随机扰动（默认无扰动） */
export function calculateUniformity(
  concentration: number,
  rng: Rng = unitRng
): number {
  const deviation = Math.abs(concentration - OPTIMAL_CONCENTRATION);
  const baseScore = Math.max(0, 100 - deviation * 1.5);
  const randomFactor = rng() * 10 - 5;
  return clamp(baseScore + randomFactor, 0, 100);
}

/** 压榨力度 = 基础区间 + 外部注入的随机扰动；可通过 force 直接指定（边界测试用） */
export function calculatePressLevel(rng: Rng = unitRng): number {
  return 70 + rng() * 25;
}

export function isPressInRange(pressLevel: number): boolean {
  return pressLevel >= PRESS_MIN && pressLevel <= PRESS_MAX;
}

export function calculateBreakProbability(
  uniformity: number,
  dryness: number
): number {
  const uniformityFactor = (100 - uniformity) * 0.3;
  const drynessFactor = dryness > 90 ? (dryness - 90) * 2 : 0;
  return Math.min(30, uniformityFactor + drynessFactor);
}

export function gradeFromScore(score: number): QualityGrade {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'medium';
  return 'poor';
}

export interface QualityScoreBreakdown {
  concentrationScore: number;
  uniformityScore: number;
  drynessScore: number;
  pressScore: number;
  inspectionBonus: number;
  score: number;
  grade: QualityGrade;
}

/** 纯函数质检评分，所有输入相同则结果必然相同 */
export function calculateQualityScore(
  concentration: number,
  uniformity: number,
  dryness: number,
  pressLevel: number,
  inspectionPoints: number
): QualityScoreBreakdown {
  const concentrationScore =
    100 - Math.abs(concentration - OPTIMAL_CONCENTRATION) * 1.2;
  const uniformityScore = uniformity;
  const drynessScore = dryness >= 95 ? 100 : dryness * 1.05;
  const pressScore =
    pressLevel >= PRESS_MIN && pressLevel <= PRESS_MAX
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

  return {
    concentrationScore,
    uniformityScore,
    drynessScore,
    pressScore,
    inspectionBonus,
    score,
    grade: gradeFromScore(score),
  };
}

function snapshot(state: SimState): SimState {
  return {
    materials: { ...state.materials },
    concentration: state.concentration,
    paper: state.paper ? { ...state.paper } : null,
    result: state.result ? { ...state.result } : null,
  };
}

function violation(
  type: SimViolation['type'],
  message: string
): SimViolation {
  return { type, message };
}

function withEntry(
  state: SimState,
  op: SimOperation,
  applied: boolean,
  violations: SimViolation[]
): SimTraceEntry {
  return { op, applied, violations, state: snapshot(state) };
}

export function applyOperation(
  state: SimState,
  op: SimOperation,
  options: SimOptions = {}
): SimTraceEntry {
  const rng = options.rng ?? unitRng;

  switch (op.type) {
    case 'addMaterial':
      return applyAddMaterial(state, op);
    case 'scoop':
      return applyScoop(state, rng);
    case 'press':
      return applyPress(state, op.force, rng);
    case 'dry':
      return applyDry(state, op.dryness);
    case 'inspect':
      return applyInspect(state);
    case 'finalize':
      return applyFinalize(state);
    case 'reset':
      return withEntry(createInitialState(), op, true, []);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown operation: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function applyAddMaterial(
  state: SimState,
  op: Extract<SimOperation, { type: 'addMaterial' }>
): SimTraceEntry {
  const violations: SimViolation[] = [];

  if (state.paper) {
    violations.push(
      violation(
        'INVALID_SEQUENCE',
        '抄纸已开始，不能再调整配料；本次调整被拒绝'
      )
    );
    return withEntry(state, op, false, violations);
  }

  const rawValue = state.materials[op.material] + op.amount;
  const clampedValue = clamp(rawValue, MATERIAL_MIN, MATERIAL_MAX);
  if (rawValue < MATERIAL_MIN || rawValue > MATERIAL_MAX) {
    violations.push(
      violation(
        'MATERIAL_OUT_OF_RANGE',
        `${op.material} 配料量 ${rawValue} 越界 [${MATERIAL_MIN}, ${MATERIAL_MAX}]，按 ${clampedValue} 计`
      )
    );
  }

  const materials = {
    ...state.materials,
    [op.material]: clampedValue,
  };
  const rawConcentration =
    materials.chuPi + materials.sangPi + materials.maXianWei;
  const concentration = calculateConcentration(materials);
  if (rawConcentration < CONCENTRATION_MIN || rawConcentration > CONCENTRATION_MAX) {
    violations.push(
      violation(
        'CONCENTRATION_OUT_OF_RANGE',
        `配料总量 ${rawConcentration} 越界 [${CONCENTRATION_MIN}, ${CONCENTRATION_MAX}]，浓度按 ${concentration} 计`
      )
    );
  }

  const next: SimState = { ...state, materials, concentration };
  return withEntry(next, op, true, violations);
}

function applyScoop(state: SimState, rng: Rng): SimTraceEntry {
  const op: SimOperation = { type: 'scoop' };
  const violations: SimViolation[] = [];

  if (state.paper) {
    violations.push(
      violation(
        'INVALID_SEQUENCE',
        '纸张已抄出，不能重复抄纸；本次操作被拒绝'
      )
    );
    return withEntry(state, op, false, violations);
  }

  const uniformity = calculateUniformity(state.concentration, rng);
  const paper: SimPaper = {
    stage: 'wet',
    uniformity,
    dryness: 0,
    pressLevel: 0,
    inspectionPoints: 0,
  };
  return withEntry({ ...state, paper }, op, true, violations);
}

function applyPress(
  state: SimState,
  force: number | undefined,
  rng: Rng
): SimTraceEntry {
  const op: SimOperation = { type: 'press', force };
  const violations: SimViolation[] = [];

  if (!state.paper) {
    violations.push(
      violation('NO_PAPER', '尚无纸坯可压榨；本次操作被拒绝')
    );
    return withEntry(state, op, false, violations);
  }
  if (state.paper.stage !== 'wet') {
    violations.push(
      violation(
        'INVALID_SEQUENCE',
        `当前阶段 ${state.paper.stage} 不可压榨；本次操作被拒绝`
      )
    );
    return withEntry(state, op, false, violations);
  }

  const pressLevel = force !== undefined ? force : calculatePressLevel(rng);
  if (!isPressInRange(pressLevel)) {
    violations.push(
      violation(
        'PRESS_OUT_OF_RANGE',
        `压榨力度 ${round(pressLevel)} 落在合理区间 [${PRESS_MIN}, ${PRESS_MAX}] 之外，仍继续后续工序`
      )
    );
  }

  const paper: SimPaper = {
    ...state.paper,
    stage: 'pressed',
    pressLevel,
    dryness: POST_PRESS_DRYNESS,
  };
  return withEntry({ ...state, paper }, op, true, violations);
}

function applyDry(state: SimState, drynessInput: number): SimTraceEntry {
  const op: SimOperation = { type: 'dry', dryness: drynessInput };
  const violations: SimViolation[] = [];

  if (!state.paper) {
    violations.push(
      violation('NO_PAPER', '尚无纸坯可晾晒；本次操作被拒绝')
    );
    return withEntry(state, op, false, violations);
  }
  if (state.paper.stage !== 'pressed' && state.paper.stage !== 'drying') {
    violations.push(
      violation(
        'INVALID_SEQUENCE',
        `当前阶段 ${state.paper.stage} 不可晾晒；本次操作被拒绝`
      )
    );
    return withEntry(state, op, false, violations);
  }

  const dryness = clamp(drynessInput, CONCENTRATION_MIN, DRY_DONE_THRESHOLD);
  const stage =
    dryness >= DRY_DONE_THRESHOLD
      ? ('dried' as const)
      : ('drying' as const);

  const paper: SimPaper = { ...state.paper, dryness, stage };
  return withEntry({ ...state, paper }, op, true, violations);
}

function applyInspect(state: SimState): SimTraceEntry {
  const op: SimOperation = { type: 'inspect' };
  const violations: SimViolation[] = [];

  if (!state.paper) {
    violations.push(
      violation('NO_PAPER', '尚无纸张可检验；本次操作被拒绝')
    );
    return withEntry(state, op, false, violations);
  }

  if (state.paper.inspectionPoints >= MAX_INSPECTION_POINTS) {
    violations.push(
      violation(
        'INSPECTION_LIMIT_EXCEEDED',
        `检验点已达上限 ${MAX_INSPECTION_POINTS}，本次点击不计入`
      )
    );
    return withEntry(state, op, false, violations);
  }

  if (state.paper.dryness < DRY_DONE_THRESHOLD) {
    violations.push(
      violation(
        'INSPECT_BEFORE_DRIED',
        `干燥进度 ${Math.round(state.paper.dryness)}% 未完成即检验（<${DRY_DONE_THRESHOLD}%），检验点仍计入但得分会反映干燥不足`
      )
    );
  }

  const paper: SimPaper = {
    ...state.paper,
    stage: 'inspecting',
    inspectionPoints: state.paper.inspectionPoints + 1,
  };
  return withEntry({ ...state, paper }, op, true, violations);
}

function applyFinalize(state: SimState): SimTraceEntry {
  const op: SimOperation = { type: 'finalize' };
  const violations: SimViolation[] = [];

  if (!state.paper) {
    violations.push(
      violation('NO_PAPER', '尚无纸张，无法评定质量；本次操作被拒绝')
    );
    return withEntry(state, op, false, violations);
  }

  if (state.paper.dryness < DRY_DONE_THRESHOLD) {
    violations.push(
      violation(
        'INSPECT_BEFORE_DRIED',
        `干燥未完成（${Math.round(state.paper.dryness)}%）即出结论，评级按当前干燥度计算`
      )
    );
  }

  const result = calculateQualityScore(
    state.concentration,
    state.paper.uniformity,
    state.paper.dryness,
    state.paper.pressLevel,
    state.paper.inspectionPoints
  );

  const paper: SimPaper = { ...state.paper, stage: 'done' };
  const next: SimState = {
    ...state,
    paper,
    result: { score: result.score, grade: result.grade },
  };
  return withEntry(next, op, true, violations);
}

/** 对一组操作序列做批量推演；同一初始状态、同一 rng、同一序列结果完全一致 */
export function runSimulation(
  operations: SimOperation[],
  options: SimOptions & { initial?: SimState } = {}
): SimOutcome {
  let state = options.initial
    ? snapshot(options.initial)
    : createInitialState();
  const trace: SimTraceEntry[] = [];
  for (const op of operations) {
    const entry = applyOperation(state, op, options);
    trace.push(entry);
    state = entry.state;
  }
  return { trace, finalState: state };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
