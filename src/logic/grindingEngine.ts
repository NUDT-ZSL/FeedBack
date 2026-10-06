import {
  GRIT_COEFFICIENTS,
  MAX_REFLECTIVITY,
  MIN_REFLECTIVITY,
  SCRATCH_THRESHOLD,
} from '../types/index.ts';
import type { GritType, Scratch } from '../types/index.ts';

export const MAX_FORCE = 2;
const MIN_FORCE = 0;
const MAX_DT_SECONDS = 0.1;

const EVENTS_PER_SECOND = 60;
const GRIND_RATE = 0.1 * EVENTS_PER_SECOND;
const POLISH_RATE = 0.08 * EVENTS_PER_SECOND;
const UNIFORMITY_GAIN = 0.5;
const GRIND_CLARITY_GAIN = 0.8;
const POLISH_CLARITY_GAIN = 0.3;
const UNIFORMITY_PENALTY_PER_SECOND = 0.3 * EVENTS_PER_SECOND;

const SCRATCH_FORCE_THRESHOLD = 1.5;
const SCRATCH_ENERGY_PER_SECOND = 0.3 * EVENTS_PER_SECOND;
const REPAIR_ENERGY_POLISH_PER_SECOND = 0.05 * EVENTS_PER_SECOND;
const REPAIR_ENERGY_FINE_GRIND_PER_SECOND = 0.025 * EVENTS_PER_SECOND;

export interface ScratchPosition {
  x: number;
  y: number;
}

export type GrindingOp =
  | { type: 'startGrinding'; grit: GritType; time?: number }
  | {
      type: 'grind';
      time: number;
      force: number;
      direction: number;
      position?: ScratchPosition;
    }
  | { type: 'stopGrinding'; time?: number }
  | { type: 'startPolishing'; time?: number }
  | { type: 'polish'; time: number; force: number }
  | { type: 'stopPolishing'; time?: number };

export interface EngineSnapshot {
  grindingProgress: number;
  uniformity: number;
  reflectivity: number;
  patternClarity: number;
  scratchCount: number;
  scratches: Scratch[];
  currentGrit: GritType | null;
  isPolishing: boolean;
  isDamaged: boolean;
  polishProgress: number;
}

export type EngineEvent =
  | { type: 'scratch-added'; scratch: Scratch }
  | { type: 'scratch-fixed'; scratches: Scratch[] }
  | { type: 'damaged' }
  | { type: 'repaired' }
  | { type: 'force-clamped'; requested: number; clamped: number }
  | { type: 'ignored'; reason: string };

export interface StepResult {
  state: EngineSnapshot;
  events: EngineEvent[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const INITIAL_SNAPSHOT: EngineSnapshot = {
  grindingProgress: 0,
  uniformity: 0,
  reflectivity: MIN_REFLECTIVITY,
  patternClarity: 0,
  scratchCount: 0,
  scratches: [],
  currentGrit: null,
  isPolishing: false,
  isDamaged: false,
  polishProgress: 0,
};

export class GrindingEngine {
  private state: EngineSnapshot;
  private rng: () => number;
  private seed: number;
  private scratchIdCounter = 0;
  private lastTick: number | null = null;
  private scratchEnergy = 0;
  private nextScratchCost = 1;
  private repairEnergy = 0;
  private nextRepairCost = 1;

  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.state = { ...INITIAL_SNAPSHOT, scratches: [] };
    this.nextScratchCost = 0.5 + this.rng();
    this.nextRepairCost = 0.5 + this.rng();
  }

  reset(seed?: number): EngineSnapshot {
    if (isFiniteNumber(seed)) {
      this.seed = seed >>> 0;
    }
    this.rng = mulberry32(this.seed);
    this.state = { ...INITIAL_SNAPSHOT, scratches: [] };
    this.scratchIdCounter = 0;
    this.lastTick = null;
    this.scratchEnergy = 0;
    this.repairEnergy = 0;
    this.nextScratchCost = 0.5 + this.rng();
    this.nextRepairCost = 0.5 + this.rng();
    return this.getState();
  }

  getState(): EngineSnapshot {
    return { ...this.state, scratches: [...this.state.scratches] };
  }

  step(op: GrindingOp): StepResult {
    switch (op.type) {
      case 'startGrinding':
        return this.startGrinding(op.grit, op.time);
      case 'grind':
        return this.applyGrind(op.time, op.force, op.direction, op.position);
      case 'stopGrinding':
        return this.stopGrinding();
      case 'startPolishing':
        return this.startPolishing(op.time);
      case 'polish':
        return this.applyPolish(op.time, op.force);
      case 'stopPolishing':
        return this.stopPolishing();
      default: {
        const exhaustiveCheck: never = op;
        throw new Error(`Unknown op: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  private snapshot(events: EngineEvent[]): StepResult {
    return { state: this.getState(), events };
  }

  private sanitizeForce(force: number, events: EngineEvent[]): number {
    if (!isFiniteNumber(force)) {
      events.push({ type: 'force-clamped', requested: force, clamped: 0 });
      return 0;
    }
    if (force < MIN_FORCE || force > MAX_FORCE) {
      events.push({
        type: 'force-clamped',
        requested: force,
        clamped: clamp(force, MIN_FORCE, MAX_FORCE),
      });
    }
    return clamp(force, MIN_FORCE, MAX_FORCE);
  }

  private elapsedSeconds(time: number): number {
    if (!isFiniteNumber(time)) {
      this.lastTick = null;
      return 0;
    }
    if (this.lastTick === null) {
      this.lastTick = time;
      return 0;
    }
    const dt = clamp((time - this.lastTick) / 1000, 0, MAX_DT_SECONDS);
    this.lastTick = time;
    return dt;
  }

  private startGrinding(grit: GritType, time?: number): StepResult {
    const events: EngineEvent[] = [];
    if (!isFiniteNumber(grit) || !(grit in GRIT_COEFFICIENTS)) {
      events.push({ type: 'ignored', reason: 'invalid-grit' });
      return this.snapshot(events);
    }
    this.state.currentGrit = grit;
    this.state.isPolishing = false;
    this.lastTick = isFiniteNumber(time) ? (time as number) : null;
    return this.snapshot(events);
  }

  private stopGrinding(): StepResult {
    const events: EngineEvent[] = [];
    if (this.state.currentGrit === null) {
      events.push({ type: 'ignored', reason: 'not-grinding' });
      return this.snapshot(events);
    }
    this.state.currentGrit = null;
    this.lastTick = null;
    return this.snapshot(events);
  }

  private startPolishing(time?: number): StepResult {
    const events: EngineEvent[] = [];
    this.state.isPolishing = true;
    this.state.currentGrit = null;
    this.lastTick = isFiniteNumber(time) ? (time as number) : null;
    return this.snapshot(events);
  }

  private stopPolishing(): StepResult {
    const events: EngineEvent[] = [];
    if (!this.state.isPolishing) {
      events.push({ type: 'ignored', reason: 'not-polishing' });
      return this.snapshot(events);
    }
    this.state.isPolishing = false;
    this.lastTick = null;
    return this.snapshot(events);
  }

  private applyGrind(
    time: number,
    rawForce: number,
    rawDirection: number,
    position?: ScratchPosition
  ): StepResult {
    const events: EngineEvent[] = [];
    if (this.state.currentGrit === null) {
      events.push({ type: 'ignored', reason: 'no-active-grit' });
      return this.snapshot(events);
    }

    const force = this.sanitizeForce(rawForce, events);
    const direction = isFiniteNumber(rawDirection) ? rawDirection : 0;
    const dt = this.elapsedSeconds(time);

    const coefficient = GRIT_COEFFICIENTS[this.state.currentGrit];
    const efficiency = force * coefficient * GRIND_RATE * dt;

    const progress = Math.min(100, this.state.grindingProgress + efficiency);
    const gainedUniformity = Math.min(100, this.state.uniformity + efficiency * UNIFORMITY_GAIN);
    const directionVariance =
      Math.abs(direction - gainedUniformity * 3.6) / 360;
    const uniformityPenalty =
      directionVariance * UNIFORMITY_PENALTY_PER_SECOND * dt;
    const uniformity = Math.max(0, gainedUniformity - uniformityPenalty);
    const patternClarity = Math.min(
      100,
      this.state.patternClarity + efficiency * GRIND_CLARITY_GAIN
    );

    this.state.grindingProgress = progress;
    this.state.uniformity = uniformity;
    this.state.patternClarity = patternClarity;
    this.state.reflectivity = this.reflectivity();

    if (this.state.currentGrit === 120 && force > SCRATCH_FORCE_THRESHOLD) {
      this.scratchEnergy +=
        (force - SCRATCH_FORCE_THRESHOLD) * SCRATCH_ENERGY_PER_SECOND * dt;
      this.consumeScratchEnergy(position, events);
    }
    if (this.state.currentGrit === 1200) {
      this.repairEnergy += force * REPAIR_ENERGY_FINE_GRIND_PER_SECOND * dt;
      this.consumeRepairEnergy(events);
    }

    return this.snapshot(events);
  }

  private applyPolish(time: number, rawForce: number): StepResult {
    const events: EngineEvent[] = [];
    if (!this.state.isPolishing) {
      events.push({ type: 'ignored', reason: 'not-polishing' });
      return this.snapshot(events);
    }

    const force = this.sanitizeForce(rawForce, events);
    const dt = this.elapsedSeconds(time);

    const efficiency = force * POLISH_RATE * dt;
    this.state.polishProgress = Math.min(100, this.state.polishProgress + efficiency);
    this.state.patternClarity = Math.min(
      100,
      this.state.patternClarity + efficiency * POLISH_CLARITY_GAIN
    );
    this.state.reflectivity = this.reflectivity();

    this.repairEnergy += force * REPAIR_ENERGY_POLISH_PER_SECOND * dt;
    this.consumeRepairEnergy(events);

    return this.snapshot(events);
  }

  private reflectivity(): number {
    return Math.min(
      MAX_REFLECTIVITY,
      MIN_REFLECTIVITY +
        this.state.grindingProgress * 0.5 +
        this.state.polishProgress * 0.25
    );
  }

  private consumeScratchEnergy(
    position: ScratchPosition | undefined,
    events: EngineEvent[]
  ): void {
    const origin = position ?? { x: 0.5, y: 0.5 };
    while (this.scratchEnergy >= this.nextScratchCost) {
      this.scratchEnergy -= this.nextScratchCost;
      const angle = this.rng() * Math.PI * 2;
      const length = 0.05 + this.rng() * 0.1;
      const x2 = origin.x + Math.cos(angle) * length;
      const y2 = origin.y + Math.sin(angle) * length;
      const scratch: Scratch = {
        id: this.scratchIdCounter++,
        x1: clamp(origin.x, 0, 1),
        y1: clamp(origin.y, 0, 1),
        x2: clamp(x2, 0, 1),
        y2: clamp(y2, 0, 1),
        opacity: 0.6 + this.rng() * 0.3,
      };
      this.state.scratches = [...this.state.scratches, scratch];
      this.state.scratchCount = this.state.scratches.length;
      events.push({ type: 'scratch-added', scratch });
      if (!this.state.isDamaged && this.state.scratchCount >= SCRATCH_THRESHOLD) {
        this.state.isDamaged = true;
        events.push({ type: 'damaged' });
      }
      this.nextScratchCost = 0.5 + this.rng();
    }
  }

  private consumeRepairEnergy(events: EngineEvent[]): void {
    while (this.repairEnergy >= this.nextRepairCost) {
      this.repairEnergy -= this.nextRepairCost;
      if (this.state.scratches.length > 0) {
        this.fixOneScratch(events);
      }
      this.nextRepairCost = 0.5 + this.rng();
    }
  }

  private fixOneScratch(events: EngineEvent[]): void {
    const candidates = [...this.state.scratches];
    const target = candidates.findIndex((s) => s.opacity > 0.3);
    if (target >= 0) {
      candidates[target] = {
        ...candidates[target],
        opacity: Math.max(0, candidates[target].opacity - 0.2),
      };
    } else {
      candidates.shift();
    }
    const remaining = candidates.filter((s) => s.opacity > 0.1);
    this.state.scratches = remaining;
    this.state.scratchCount = remaining.length;
    events.push({ type: 'scratch-fixed', scratches: remaining.map((s) => ({ ...s })) });
    if (this.state.isDamaged && this.state.scratchCount < SCRATCH_THRESHOLD) {
      this.state.isDamaged = false;
      events.push({ type: 'repaired' });
    }
  }
}

export function replay(ops: GrindingOp[], seed = 1): StepResult[] {
  const engine = new GrindingEngine(seed);
  return ops.map((op) => engine.step(op));
}
