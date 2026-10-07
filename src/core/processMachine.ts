import type { PaperState, ProcessStage } from '@/types';
import {
  calculateDryness,
  calculateFragmentation,
  calculateUniformity,
  clamp,
} from '@/utils/paperMath';

export const BOILING_TARGET = 100;
export const FRAGMENTATION_READY = 80;
export const UNIFORMITY_RETRY_THRESHOLD = 60;
export const HITS_PER_FRAGMENTATION_STEP = 5;
export const BOILING_RATE_PER_SECOND = 50;

export interface WorkshopState {
  stage: ProcessStage;
  paper: PaperState;
  hitCount: number;
  scoopAttempts: number;
  needsRescoop: boolean;
  pressed: boolean;
}

export type WorkshopEvent =
  | { type: 'START_BOILING' }
  | { type: 'TICK_BOILING'; deltaTime: number }
  | { type: 'BOIL_COMPLETE' }
  | { type: 'HIT_PESTLE' }
  | { type: 'SIEVE' }
  | { type: 'SCOOP_DRAG_END'; positions: { x: number; y: number; t: number }[] }
  | { type: 'PRESS' }
  | { type: 'TICK_DRYING'; lightIntensity: number; deltaTime: number }
  | { type: 'FINISH'; watermark: string; poemText?: string }
  | { type: 'RESET'; textureSeed?: number };

export function createInitialState(textureSeed = Math.random()): WorkshopState {
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
    scoopAttempts: 0,
    needsRescoop: false,
    pressed: false,
  };
}

/**
 * 纯函数状态转移：所有事件在同一份先前状态上原子地推导出下一份状态，
 * 快速连续事件（如捞纸拖拽与晒纸干燥 tick 交错）不会互相覆盖彼此的更新。
 */
export function reduce(state: WorkshopState, event: WorkshopEvent): WorkshopState {
  switch (event.type) {
    case 'START_BOILING': {
      if (state.stage !== 'boiling_idle') return state;
      return { ...state, stage: 'boiling_active' };
    }
    case 'TICK_BOILING': {
      if (state.stage !== 'boiling_active') return state;
      const boilingProgress = clamp(
        state.paper.boilingProgress + BOILING_RATE_PER_SECOND * event.deltaTime,
        0,
        BOILING_TARGET,
      );
      return { ...state, paper: { ...state.paper, boilingProgress } };
    }
    case 'BOIL_COMPLETE': {
      if (state.stage !== 'boiling_active') return state;
      if (state.paper.boilingProgress < BOILING_TARGET) return state;
      return { ...state, stage: 'beating_active' };
    }
    case 'HIT_PESTLE': {
      if (state.stage !== 'beating_active') return state;
      const hitCount = state.hitCount + 1;
      const fragmentationLevel = clamp(calculateFragmentation(hitCount), 0, 100);
      return { ...state, hitCount, paper: { ...state.paper, fragmentationLevel } };
    }
    case 'SIEVE': {
      if (state.stage !== 'beating_active') return state;
      if (state.paper.fragmentationLevel < FRAGMENTATION_READY) return state;
      return { ...state, stage: 'scooping_active' };
    }
    case 'SCOOP_DRAG_END': {
      if (state.stage !== 'scooping_active') return state;
      const sample = calculateUniformity(event.positions);
      const scoopAttempts = state.scoopAttempts + 1;
      const uniformity =
        state.scoopAttempts === 0
          ? sample
          : (state.paper.uniformity * state.scoopAttempts + sample) / scoopAttempts;
      return {
        ...state,
        scoopAttempts,
        needsRescoop: uniformity < UNIFORMITY_RETRY_THRESHOLD,
        paper: { ...state.paper, uniformity },
      };
    }
    case 'PRESS': {
      if (state.stage !== 'scooping_active') return state;
      if (state.needsRescoop || state.scoopAttempts === 0) return state;
      return { ...state, stage: 'drying_active', pressed: true };
    }
    case 'TICK_DRYING': {
      if (state.stage !== 'drying_active') return state;
      const dryness = calculateDryness(state.paper.dryness, event.lightIntensity, event.deltaTime);
      return { ...state, paper: { ...state.paper, dryness } };
    }
    case 'FINISH': {
      if (state.stage !== 'drying_active') return state;
      return {
        ...state,
        stage: 'finished',
        paper: {
          ...state.paper,
          watermark: event.watermark,
          poemText: event.poemText ?? state.paper.poemText,
        },
      };
    }
    case 'RESET': {
      return createInitialState(event.textureSeed ?? Math.random());
    }
  }
}

export function computeQuality(paper: PaperState): number {
  return Math.round(
    paper.uniformity * 0.4 + paper.dryness * 0.3 + paper.fragmentationLevel * 0.2 + paper.boilingProgress * 0.1,
  );
}

export type WorkshopListener = (state: WorkshopState, event: WorkshopEvent) => void;

/**
 * 无框架依赖的工序状态机：持有当前状态，按顺序应用事件，
 * 并向订阅者广播。视图层（React hook / 组件）只是它的一个订阅者。
 */
export class PaperWorkshopMachine {
  private state: WorkshopState;
  private listeners = new Set<WorkshopListener>();

  constructor(initialState?: WorkshopState) {
    this.state = initialState ?? createInitialState();
  }

  getState(): WorkshopState {
    return this.state;
  }

  dispatch(event: WorkshopEvent): WorkshopState {
    const next = reduce(this.state, event);
    if (next !== this.state) {
      this.state = next;
      for (const listener of this.listeners) {
        listener(next, event);
      }
    }
    return this.state;
  }

  subscribe(listener: WorkshopListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
