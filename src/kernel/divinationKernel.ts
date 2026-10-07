import { baguaMatchRules } from '../lib/starData.ts';

export const TRIGRAM_SLOT_COUNT = 8;
export const SLOT_ANGLE_DEG = 360 / TRIGRAM_SLOT_COUNT;
export const BEAM_RADIUS = 1.5;
export const BEAM_Y = -3;
export const BEAM_DURATION_MS = 2000;
export const ERROR_DURATION_MS = 400;
export const ROTATION_SENSITIVITY = 0.5;

export type Direction = readonly [number, number];

export interface LightBeamState {
  slot: number;
  position: [number, number, number];
  visible: boolean;
  startedAt: number;
  expiresAt: number;
}

export interface DivinationState {
  rotation: [number, number];
  isDraggingSphere: boolean;
  draggedTalisman: string | null;
  isDragOverBagua: boolean;
  lightBeam: LightBeamState | null;
  baguaError: boolean;
}

export interface DropOutcome {
  talisman: string;
  slot: number;
  expectedSlot: number;
  matched: boolean;
  at: number;
}

export type KernelEvent =
  | { type: 'sphereDragStart' }
  | { type: 'sphereDragMove'; deltaX: number; deltaY: number }
  | { type: 'sphereDragEnd' }
  | { type: 'talismanDragStart'; talisman: string }
  | { type: 'talismanDragEnd'; talisman?: string }
  | { type: 'baguaDragOver' }
  | { type: 'baguaDragLeave' }
  | { type: 'baguaDrop'; direction: Direction }
  | { type: 'tick'; now?: number };

export interface KernelOptions {
  now?: () => number;
  beamDurationMs?: number;
  errorDurationMs?: number;
  rotationSensitivity?: number;
}

export type StateListener = (state: DivinationState) => void;

const INITIAL_STATE: DivinationState = {
  rotation: [0, 0],
  isDraggingSphere: false,
  draggedTalisman: null,
  isDragOverBagua: false,
  lightBeam: null,
  baguaError: false,
};

function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function directionForSlot(slot: number): [number, number] {
  const deg = slot * SLOT_ANGLE_DEG - 90;
  const rad = deg * Math.PI / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

export function computeBeamPosition(slot: number): [number, number, number] {
  const [x, y] = directionForSlot(slot);
  return [x * BEAM_RADIUS, BEAM_Y, y * BEAM_RADIUS];
}

export function resolveTrigramSlot(direction: Direction): number {
  const [x, y] = direction;
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) {
    return -1;
  }
  const deg = Math.atan2(y, x) * 180 / Math.PI;
  return Math.round(normalizeDeg(deg + 360 + 90) / SLOT_ANGLE_DEG) % TRIGRAM_SLOT_COUNT;
}

export function createInitialState(): DivinationState {
  return {
    ...INITIAL_STATE,
    rotation: [0, 0],
  };
}

export class DivinationKernel {
  private state: DivinationState;
  private errorExpiresAt: number | null = null;
  private readonly listeners = new Set<StateListener>();
  private readonly now: () => number;
  private readonly beamDurationMs: number;
  private readonly errorDurationMs: number;
  private readonly rotationSensitivity: number;

  constructor(options: KernelOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.beamDurationMs = options.beamDurationMs ?? BEAM_DURATION_MS;
    this.errorDurationMs = options.errorDurationMs ?? ERROR_DURATION_MS;
    this.rotationSensitivity = options.rotationSensitivity ?? ROTATION_SENSITIVITY;
    this.state = createInitialState();
  }

  getState(): DivinationState {
    return {
      ...this.state,
      rotation: [this.state.rotation[0], this.state.rotation[1]],
      lightBeam: this.state.lightBeam ? { ...this.state.lightBeam, position: [...this.state.lightBeam.position] as [number, number, number] } : null,
    };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getNextExpiryAt(): number | null {
    const beamExpiry = this.state.lightBeam?.expiresAt ?? null;
    if (beamExpiry === null) return this.errorExpiresAt;
    if (this.errorExpiresAt === null) return beamExpiry;
    return Math.min(beamExpiry, this.errorExpiresAt);
  }

  dispatch(event: KernelEvent): DropOutcome | null {
    const state = this.state;
    let outcome: DropOutcome | null = null;

    switch (event.type) {
      case 'sphereDragStart':
        state.isDraggingSphere = true;
        break;
      case 'sphereDragMove':
        if (state.isDraggingSphere) {
          state.rotation = [
            normalizeDeg(state.rotation[0] + event.deltaY * this.rotationSensitivity),
            normalizeDeg(state.rotation[1] + event.deltaX * this.rotationSensitivity),
          ];
        }
        break;
      case 'sphereDragEnd':
        state.isDraggingSphere = false;
        break;
      case 'talismanDragStart':
        state.draggedTalisman = event.talisman;
        break;
      case 'talismanDragEnd':
        if (event.talisman === undefined || event.talisman === state.draggedTalisman) {
          state.draggedTalisman = null;
          state.isDragOverBagua = false;
        }
        break;
      case 'baguaDragOver':
        state.isDragOverBagua = true;
        break;
      case 'baguaDragLeave':
        state.isDragOverBagua = false;
        break;
      case 'baguaDrop': {
        state.isDragOverBagua = false;
        outcome = this.resolveDrop(event.direction);
        break;
      }
      case 'tick':
        this.expire(event.now ?? this.now());
        break;
    }

    this.emit();
    return outcome;
  }

  private resolveDrop(direction: Direction): DropOutcome | null {
    const state = this.state;
    const talisman = state.draggedTalisman;
    if (talisman === null) {
      return null;
    }
    const slot = resolveTrigramSlot(direction);
    if (slot < 0) {
      return null;
    }
    state.draggedTalisman = null;
    const at = this.now();
    const expectedSlot = baguaMatchRules[talisman];
    const matched = expectedSlot === slot;
    if (matched) {
      state.lightBeam = {
        slot,
        position: computeBeamPosition(slot),
        visible: true,
        startedAt: at,
        expiresAt: at + this.beamDurationMs,
      };
    } else {
      state.baguaError = true;
      this.errorExpiresAt = at + this.errorDurationMs;
    }
    return { talisman, slot, expectedSlot: expectedSlot ?? -1, matched, at };
  }

  private expire(now: number): void {
    const state = this.state;
    if (state.lightBeam !== null && now >= state.lightBeam.expiresAt) {
      state.lightBeam = null;
    }
    if (this.errorExpiresAt !== null && now >= this.errorExpiresAt) {
      this.errorExpiresAt = null;
      state.baguaError = false;
    }
  }

  private emit(): void {
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
