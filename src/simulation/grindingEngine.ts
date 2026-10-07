/**
 * 铜镜研磨 / 抛光纯逻辑引擎。
 *
 * 设计目标：
 * - 可独立驱动：不依赖 React / DOM / 音频，输入为带时刻与力度的事件序列。
 * - 可重放：所有随机性来自外部传入的固定种子（mulberry32）。
 * - 帧率无关：进度按 dt（事件时刻差）积分；划痕与修复采用时间 rescale 的
 *   泊松过程（累积风险率到达指数阈值即触发），触发点只取决于时间轴，
 *   与事件切分粒度无关，因此同一序列以不同帧率喂入结果一致。
 * - 边界稳定：力度越界被钳制、目数为空 / 重复停止为幂等无操作，
 *   均返回确定结果而不是静默丢弃或抛错。
 *
 * 速率常量由旧的“每次移动回调固定增量”模型按 60fps 参考帧率折算而来，
 * 保证界面手感与重构前一致。
 */
import {
  GRIT_COEFFICIENTS,
  SCRATCH_THRESHOLD,
  MAX_REFLECTIVITY,
  MIN_REFLECTIVITY,
} from '../types/index.ts';
import type { GritType, Scratch, StepEffects } from '../types/index.ts';
import { mulberry32, deriveSeed } from './random.ts';
import type { RandomSource } from './random.ts';

/** 镜面状态快照（纯数据，可序列化、可断言）。 */
export interface MirrorState {
  grindingProgress: number;
  uniformity: number;
  reflectivity: number;
  patternClarity: number;
  scratchCount: number;
  scratches: Scratch[];
  isDamaged: boolean;
  polishProgress: number;
  currentGrit: GritType | null;
  isPolishing: boolean;
}

/** 引擎输入事件。time 为毫秒时间戳（同源单调时钟即可，如 performance.now()）。 */
export type EngineEvent =
  | { kind: 'startGrinding'; time: number; grit: GritType }
  | { kind: 'grind'; time: number; force: number; direction: number; x?: number; y?: number }
  | { kind: 'stopGrinding'; time: number }
  | { kind: 'startPolishing'; time: number }
  | { kind: 'polish'; time: number; force: number }
  | { kind: 'stopPolishing'; time: number };

/** 单步结果：该步之后的确定状态 + 该步产生的副作用（供界面播音效等）。 */
export interface StepResult {
  state: MirrorState;
  effects: StepEffects;
}

export interface GrindingEngine {
  apply: (event: EngineEvent) => StepResult;
  getState: () => MirrorState;
  reset: (seed?: number) => void;
}

const LEGACY_FRAME_RATE = 60;

const GRIND_EFFICIENCY_PER_SEC = 0.1 * LEGACY_FRAME_RATE;
const UNIFORMITY_GAIN = 0.5;
const CLARITY_GAIN = 0.8;
/** 均度方向惩罚：dU/dt = 增益 - |direction - 3.6U| * 该系数。 */
const UNIFORMITY_DIRECTION_SCALE = (0.3 * LEGACY_FRAME_RATE) / 360;
const UNIFORMITY_DECAY_PER_SEC = UNIFORMITY_DIRECTION_SCALE * 3.6;

const POLISH_EFFICIENCY_PER_SEC = 0.08 * LEGACY_FRAME_RATE;
const POLISH_CLARITY_GAIN = 0.3;

const COARSE_GRIT: GritType = 120;
const FINE_GRIT: GritType = 1200;
const SCRATCH_FORCE_THRESHOLD = 1.5;
/** 粗磨划痕风险率：lambda = (force - 阈值) * 该系数（次/秒）。 */
const SCRATCH_HAZARD_PER_SEC = 0.3 * LEGACY_FRAME_RATE;
/** 抛光修复风险率：lambda = force * 该系数（次/秒）。 */
const POLISH_REPAIR_HAZARD_PER_SEC = 0.05 * LEGACY_FRAME_RATE;
/** 精磨修复风险率：lambda = 研磨效率 * 该系数（次/秒）。 */
const FINE_GRIND_REPAIR_HAZARD = 0.1;

const MAX_FORCE = 2;
const DEFAULT_SCRATCH_X = 0.5;
const DEFAULT_SCRATCH_Y = 0.5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** 力度越界 / 非有限值统一钳制到 [0, MAX_FORCE]，保证稳定结果。 */
export function sanitizeForce(force: number): number {
  if (!Number.isFinite(force)) return 0;
  return Math.min(MAX_FORCE, Math.max(0, force));
}

function sanitizeDirection(direction: number): number {
  if (!Number.isFinite(direction)) return 0;
  return ((direction % 360) + 360) % 360;
}

function sanitizePosition(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 均度的解析推进。均度满足分段线性 ODE：
 *   dU/dt = gainRate - |direction - 3.6U| * UNIFORMITY_DIRECTION_SCALE
 * 在事件间隔内对该 ODE 精确求解（必要时在分支边界 / 上限处子步切换），
 * 使结果只取决于时间轴而与事件切分粒度无关——这是均度帧率无关的关键。
 */
export function advanceUniformity(
  u0: number,
  direction: number,
  gainRate: number,
  dtSec: number
): number {
  const decay = UNIFORMITY_DECAY_PER_SEC;
  const scale = UNIFORMITY_DIRECTION_SCALE;
  const threshold = direction / 3.6;
  let u = Math.min(100, Math.max(0, u0));
  let remaining = dtSec;

  for (let guard = 0; guard < 4 && remaining > 0; guard += 1) {
    if (u <= threshold) {
      // 分支 A：U' = decay * (U - Ua)，Ua = (scale*d - gain) / decay
      const ua = (scale * direction - gainRate) / decay;
      if (u === ua) break; // 平衡点
      const end = ua + (u - ua) * Math.exp(decay * remaining);
      const ceiling = Math.min(threshold, 100);
      if (u > ua && end > ceiling) {
        // 越过分支边界或上限：先推进到边界，再切换分支
        const tCross = Math.log((ceiling - ua) / (u - ua)) / decay;
        u = ceiling;
        remaining -= tCross;
        continue;
      }
      u = end;
      break;
    }
    // 分支 B：U' = -decay * (U - Ub)，Ub = (gain + scale*d) / decay > threshold
    const ub = (gainRate + scale * direction) / decay;
    if (u === ub) break; // 平衡点
    const end = ub + (u - ub) * Math.exp(-decay * remaining);
    if (u < ub && end > 100) {
      u = 100; // 渐近越过上限后钉在上限
      break;
    }
    u = end;
    break;
  }

  return Math.min(100, Math.max(0, u));
}

export function computeReflectivity(grindingProgress: number, polishProgress: number): number {
  return Math.min(
    MAX_REFLECTIVITY,
    MIN_REFLECTIVITY + grindingProgress * 0.5 + polishProgress * 0.25
  );
}

/**
 * 时间 rescale 泊松过程：accumulated 累积“风险率 × 时间”，
 * 达到指数(1)阈值即触发并重置阈值。触发次数只取决于积分后的时间轴，
 * 与事件如何切分无关，这是帧率无关随机判定的核心。
 */
interface HazardProcess {
  accumulated: number;
  threshold: number;
}

const MIN_HAZARD_THRESHOLD = 1e-9;

function drawHazardThreshold(rng: RandomSource): number {
  return Math.max(MIN_HAZARD_THRESHOLD, -Math.log(1 - rng()));
}

function createHazard(rng: RandomSource): HazardProcess {
  return { accumulated: 0, threshold: drawHazardThreshold(rng) };
}

function advanceHazard(
  hazard: HazardProcess,
  lambda: number,
  dtSec: number,
  rng: RandomSource
): number {
  if (!(lambda > 0) || !(dtSec > 0)) return 0;
  hazard.accumulated += lambda * dtSec;
  let fired = 0;
  while (hazard.accumulated >= hazard.threshold) {
    hazard.accumulated -= hazard.threshold;
    hazard.threshold = drawHazardThreshold(rng);
    fired += 1;
  }
  return fired;
}

export function createGrindingEngine(seed: number = 1): GrindingEngine {
  let currentSeed = 0;
  let hazardRng: RandomSource;
  let geometryRng: RandomSource;
  let scratchHazard: HazardProcess;
  let repairHazard: HazardProcess;
  let state: MirrorState;
  let lastTime: number | null;
  let nextScratchId: number;

  function initialize(newSeed: number): void {
    currentSeed = newSeed >>> 0;
    hazardRng = mulberry32(deriveSeed(currentSeed, 1));
    geometryRng = mulberry32(deriveSeed(currentSeed, 2));
    scratchHazard = createHazard(hazardRng);
    repairHazard = createHazard(hazardRng);
    nextScratchId = 0;
    lastTime = null;
    state = {
      grindingProgress: 0,
      uniformity: 0,
      reflectivity: MIN_REFLECTIVITY,
      patternClarity: 0,
      scratchCount: 0,
      scratches: [],
      isDamaged: false,
      polishProgress: 0,
      currentGrit: null,
      isPolishing: false,
    };
  }

  const snapshot = (): MirrorState => ({
    ...state,
    scratches: state.scratches.map((s) => ({ ...s })),
  });

  function syncDamage(): void {
    state.scratchCount = state.scratches.length;
    state.isDamaged = state.scratchCount >= SCRATCH_THRESHOLD;
  }

  function addScratch(x: number, y: number): Scratch {
    const angle = geometryRng() * Math.PI * 2;
    const length = 0.05 + geometryRng() * 0.1;
    const x1 = clamp01(x);
    const y1 = clamp01(y);
    const scratch: Scratch = {
      id: nextScratchId++,
      x1,
      y1,
      x2: clamp01(x1 + Math.cos(angle) * length),
      y2: clamp01(y1 + Math.sin(angle) * length),
      opacity: 0.6 + geometryRng() * 0.3,
    };
    state.scratches = [...state.scratches, scratch];
    return scratch;
  }

  function fixOneScratch(): boolean {
    if (state.scratches.length === 0) return false;
    const next = state.scratches.map((s) => ({ ...s }));
    const index = next.findIndex((s) => s.opacity > 0.3);
    if (index >= 0) {
      next[index].opacity = Math.max(0, next[index].opacity - 0.2);
    } else {
      next.shift();
    }
    state.scratches = next.filter((s) => s.opacity > 0.1);
    return true;
  }

  /** 计算与上一事件的间隔（秒）。时钟不回拨：倒序 / 重复 / 非法时刻产生 0 间隔。 */
  function deltaTimeSec(time: number): number {
    if (!Number.isFinite(time)) return 0;
    if (lastTime === null) {
      lastTime = time;
      return 0;
    }
    if (time <= lastTime) return 0;
    const dt = time - lastTime;
    lastTime = time;
    return dt / 1000;
  }

  function applyGrind(
    event: Extract<EngineEvent, { kind: 'grind' }>,
    dtSec: number,
    effects: StepEffects
  ): void {
    if (state.currentGrit === null) return; // 目数为空：稳定无操作
    const grit = state.currentGrit;
    const force = sanitizeForce(event.force);
    const direction = sanitizeDirection(event.direction);
    const coefficient = GRIT_COEFFICIENTS[grit];
    const efficiency = force * coefficient * GRIND_EFFICIENCY_PER_SEC * dtSec;

    state.grindingProgress = Math.min(100, state.grindingProgress + efficiency);
    const uniformityGainRate =
      force * coefficient * GRIND_EFFICIENCY_PER_SEC * UNIFORMITY_GAIN;
    state.uniformity = advanceUniformity(state.uniformity, direction, uniformityGainRate, dtSec);
    state.patternClarity = Math.min(100, state.patternClarity + efficiency * CLARITY_GAIN);
    state.reflectivity = computeReflectivity(state.grindingProgress, state.polishProgress);

    if (grit === COARSE_GRIT && force > SCRATCH_FORCE_THRESHOLD) {
      const lambda = (force - SCRATCH_FORCE_THRESHOLD) * SCRATCH_HAZARD_PER_SEC;
      const hits = advanceHazard(scratchHazard, lambda, dtSec, hazardRng);
      const x = sanitizePosition(event.x, DEFAULT_SCRATCH_X);
      const y = sanitizePosition(event.y, DEFAULT_SCRATCH_Y);
      for (let i = 0; i < hits; i += 1) {
        effects.scratchesAdded.push(addScratch(x, y));
      }
    }

    if (grit === FINE_GRIT && state.scratches.length > 0) {
      const lambda =
        force * coefficient * GRIND_EFFICIENCY_PER_SEC * FINE_GRIND_REPAIR_HAZARD;
      const hits = advanceHazard(repairHazard, lambda, dtSec, hazardRng);
      for (let i = 0; i < hits; i += 1) {
        if (fixOneScratch()) effects.repairedCount += 1;
      }
    }

    syncDamage();
  }

  function applyPolish(
    event: Extract<EngineEvent, { kind: 'polish' }>,
    dtSec: number,
    effects: StepEffects
  ): void {
    if (!state.isPolishing) return; // 未开始抛光：稳定无操作
    const force = sanitizeForce(event.force);
    const efficiency = force * POLISH_EFFICIENCY_PER_SEC * dtSec;

    state.polishProgress = Math.min(100, state.polishProgress + efficiency);
    state.patternClarity = Math.min(100, state.patternClarity + efficiency * POLISH_CLARITY_GAIN);
    state.reflectivity = computeReflectivity(state.grindingProgress, state.polishProgress);

    if (state.scratches.length > 0) {
      const lambda = force * POLISH_REPAIR_HAZARD_PER_SEC;
      const hits = advanceHazard(repairHazard, lambda, dtSec, hazardRng);
      for (let i = 0; i < hits; i += 1) {
        if (fixOneScratch()) effects.repairedCount += 1;
      }
    }

    syncDamage();
  }

  function apply(event: EngineEvent): StepResult {
    const dtSec = deltaTimeSec(event.time);
    const effects: StepEffects = { scratchesAdded: [], repairedCount: 0, becameDamaged: false };
    const wasDamaged = state.isDamaged;

    switch (event.kind) {
      case 'startGrinding':
        state.currentGrit = event.grit;
        state.isPolishing = false;
        break;
      case 'stopGrinding':
        state.currentGrit = null; // 幂等：重复停止结果相同
        break;
      case 'startPolishing':
        state.isPolishing = true;
        state.currentGrit = null;
        break;
      case 'stopPolishing':
        state.isPolishing = false; // 幂等
        break;
      case 'grind':
        applyGrind(event, dtSec, effects);
        break;
      case 'polish':
        applyPolish(event, dtSec, effects);
        break;
    }

    effects.becameDamaged = !wasDamaged && state.isDamaged;
    return { state: snapshot(), effects };
  }

  initialize(seed);

  return {
    apply,
    getState: snapshot,
    reset: (newSeed?: number) => initialize(newSeed ?? currentSeed),
  };
}

/**
 * 离线批量重放：输入操作序列与种子，输出每一步之后的确定状态与副作用。
 * 这是无界面验证的主入口。
 */
export function runSimulation(
  events: readonly EngineEvent[],
  seed: number = 1
): StepResult[] {
  const engine = createGrindingEngine(seed);
  return events.map((event) => engine.apply(event));
}
