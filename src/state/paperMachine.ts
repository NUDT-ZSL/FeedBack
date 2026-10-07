import type { PaperState, ProcessStage } from '@/types';
import {
  calculateDryness,
  calculateFragmentation,
  calculateUniformity,
  clamp,
} from '@/utils/paperMath';

export const BOILING_HOLD_MS = 2000;
export const FRAGMENTATION_THRESHOLD = 80;
export const UNIFORMITY_THRESHOLD = 60;
export const DRYNESS_THRESHOLD = 95;
export const PRESS_DURATION_MS = 3000;

export interface MachineState {
  stage: ProcessStage;
  paper: PaperState;
  hitCount: number;
  boilElapsedMs: number;
  pressElapsedMs: number;
  pressing: boolean;
  lightIntensity: number;
  scoopWeight: number;
}

export type MachineEvent =
  | { type: 'BAMBOO_OVER_VAT' }
  | { type: 'BAMBOO_LEAVE_VAT' }
  | { type: 'TICK_BOILING'; deltaMs: number }
  | { type: 'HIT_PESTLE' }
  | { type: 'SIEVE' }
  | { type: 'SCOOP_DRAG'; positions: { x: number; y: number; t: number }[] }
  | { type: 'PRESS' }
  | { type: 'TICK_PRESS'; deltaMs: number }
  | { type: 'SET_LIGHT'; intensity: number }
  | { type: 'TICK_DRYING'; deltaMs: number }
  | { type: 'SET_WATERMARK'; watermark: string }
  | { type: 'SET_POEM'; text: string }
  | { type: 'RESET' };

export type MachineEffect =
  | { type: 'steam' }
  | { type: 'pulp' }
  | { type: 'waterdrop' }
  | { type: 'stageChanged'; stage: ProcessStage }
  | { type: 'finished' };

export interface Transition {
  state: MachineState;
  effects: MachineEffect[];
}

export function createInitialState(textureSeed = Math.random()): MachineState {
  return {
    stage: 'boiling_idle',
    paper: {
      boilingProgress: 0,
      fragmentationLevel: 0,
      uniformity: 0,
      dryness: 0,
      watermark: null,
      poemText: '',
      textureSeed,
    },
    hitCount: 0,
    boilElapsedMs: 0,
    pressElapsedMs: 0,
    pressing: false,
    lightIntensity: 50,
    scoopWeight: 0,
  };
}

function transitionStage(state: MachineState, stage: ProcessStage): MachineState {
  return { ...state, stage };
}

export function reduce(state: MachineState, event: MachineEvent): Transition {
  const effects: MachineEffect[] = [];

  switch (event.type) {
    case 'BAMBOO_OVER_VAT': {
      if (state.stage !== 'boiling_idle') return { state, effects };
      const next = transitionStage(state, 'boiling_active');
      effects.push({ type: 'stageChanged', stage: 'boiling_active' });
      return { state: next, effects };
    }

    case 'BAMBOO_LEAVE_VAT': {
      if (state.stage !== 'boiling_active') return { state, effects };
      const next = transitionStage(
        {
          ...state,
          boilElapsedMs: 0,
          paper: { ...state.paper, boilingProgress: 0 },
        },
        'boiling_idle',
      );
      effects.push({ type: 'stageChanged', stage: 'boiling_idle' });
      return { state: next, effects };
    }

    case 'TICK_BOILING': {
      if (state.stage !== 'boiling_active') return { state, effects };
      const boilElapsedMs = state.boilElapsedMs + event.deltaMs;
      const boilingProgress = clamp((boilElapsedMs / BOILING_HOLD_MS) * 100, 0, 100);
      effects.push({ type: 'steam' });
      if (boilingProgress >= 100) {
        const next: MachineState = {
          ...state,
          boilElapsedMs,
          paper: { ...state.paper, boilingProgress: 100 },
          stage: 'beating_active',
        };
        effects.push({ type: 'stageChanged', stage: 'beating_active' });
        return { state: next, effects };
      }
      return {
        state: { ...state, boilElapsedMs, paper: { ...state.paper, boilingProgress } },
        effects,
      };
    }

    case 'HIT_PESTLE': {
      if (state.stage !== 'beating_active') return { state, effects };
      const hitCount = state.hitCount + 1;
      const fragmentationLevel = calculateFragmentation(hitCount);
      effects.push({ type: 'pulp' });
      return {
        state: {
          ...state,
          hitCount,
          paper: { ...state.paper, fragmentationLevel },
        },
        effects,
      };
    }

    case 'SIEVE': {
      if (state.stage !== 'beating_active') return { state, effects };
      if (state.paper.fragmentationLevel < FRAGMENTATION_THRESHOLD) return { state, effects };
      const next = transitionStage(state, 'scooping_active');
      effects.push({ type: 'stageChanged', stage: 'scooping_active' });
      return { state: next, effects };
    }

    case 'SCOOP_DRAG': {
      if (state.stage !== 'scooping_active') return { state, effects };
      if (state.pressing) return { state, effects };
      const scoopUniformity = calculateUniformity(event.positions);
      const weight = Math.max(0, event.positions.length);
      if (weight === 0) return { state, effects };
      const totalWeight = state.scoopWeight + weight;
      const uniformity =
        totalWeight === 0
          ? 0
          : (state.paper.uniformity * state.scoopWeight + scoopUniformity * weight) /
            totalWeight;
      return {
        state: {
          ...state,
          scoopWeight: totalWeight,
          paper: { ...state.paper, uniformity },
        },
        effects,
      };
    }

    case 'PRESS': {
      if (state.stage !== 'scooping_active') return { state, effects };
      if (state.pressing) return { state, effects };
      if (state.paper.uniformity < UNIFORMITY_THRESHOLD) return { state, effects };
      return { state: { ...state, pressing: true, pressElapsedMs: 0 }, effects };
    }

    case 'TICK_PRESS': {
      if (state.stage !== 'scooping_active' || !state.pressing) return { state, effects };
      const pressElapsedMs = state.pressElapsedMs + event.deltaMs;
      effects.push({ type: 'waterdrop' });
      if (pressElapsedMs >= PRESS_DURATION_MS) {
        const next: MachineState = {
          ...state,
          pressElapsedMs,
          pressing: false,
          stage: 'drying_active',
        };
        effects.push({ type: 'stageChanged', stage: 'drying_active' });
        return { state: next, effects };
      }
      return { state: { ...state, pressElapsedMs }, effects };
    }

    case 'SET_LIGHT': {
      if (state.stage !== 'drying_active') return { state, effects };
      return {
        state: { ...state, lightIntensity: clamp(event.intensity, 0, 100) },
        effects,
      };
    }

    case 'TICK_DRYING': {
      if (state.stage !== 'drying_active') return { state, effects };
      const dryness = calculateDryness(
        state.paper.dryness,
        state.lightIntensity,
        event.deltaMs,
      );
      const next: MachineState = { ...state, paper: { ...state.paper, dryness } };
      if (dryness >= DRYNESS_THRESHOLD) {
        const finished = transitionStage(next, 'finished');
        effects.push({ type: 'stageChanged', stage: 'finished' });
        effects.push({ type: 'finished' });
        return { state: finished, effects };
      }
      return { state: next, effects };
    }

    case 'SET_WATERMARK': {
      return {
        state: { ...state, paper: { ...state.paper, watermark: event.watermark } },
        effects,
      };
    }

    case 'SET_POEM': {
      return {
        state: { ...state, paper: { ...state.paper, poemText: event.text } },
        effects,
      };
    }

    case 'RESET': {
      return { state: createInitialState(state.paper.textureSeed), effects };
    }

    default:
      return { state, effects };
  }
}

export type MachineListener = (state: MachineState, effects: MachineEffect[]) => void;

export function createPaperMachine(initialState: MachineState = createInitialState()) {
  let state = initialState;
  const listeners = new Set<MachineListener>();

  return {
    getState(): MachineState {
      return state;
    },
    dispatch(event: MachineEvent): MachineEffect[] {
      const { state: next, effects } = reduce(state, event);
      state = next;
      for (const listener of listeners) {
        listener(state, effects);
      }
      return effects;
    },
    subscribe(listener: MachineListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type PaperMachine = ReturnType<typeof createPaperMachine>;
