import type {
  BambooStrip,
  Candle,
  CraftPhase,
  HangingState,
  LanternType,
  Node,
  SilkColor,
  SilkPanel,
} from '../types.ts';
import { createTemplate } from './templates.ts';

export interface LanternState {
  currentPhase: CraftPhase;
  lanternType: LanternType;
  nodes: Node[];
  bambooStrips: BambooStrip[];
  silkPanels: SilkPanel[];
  selectedColor: SilkColor;
  isAssembled: boolean;
  candle: Candle;
  rotationAngle: number;
  rotationSpeed: number;
  hanging: HangingState;
  isNightMode: boolean;
}

export type LanternEvent =
  | { type: 'phase/set'; phase: CraftPhase }
  | { type: 'node/dragStart'; nodeId: string }
  | { type: 'node/dragMove'; nodeId: string; dx: number; dy: number }
  | { type: 'node/dragEnd'; nodeId: string }
  | { type: 'strip/connect'; startNodeId: string; endNodeId: string }
  | { type: 'silk/selectColor'; color: SilkColor }
  | { type: 'silk/paste'; panelId: string; progressDelta: number; tensionDelta: number }
  | { type: 'silk/detach'; panelId: string }
  | { type: 'frame/assemble' }
  | { type: 'candle/light' }
  | { type: 'candle/tick'; dtMs: number; noise?: number }
  | { type: 'display/setRotationSpeed'; speed: number }
  | { type: 'display/rotate'; dtMs: number }
  | { type: 'lantern/hang'; hookId: string }
  | { type: 'lantern/unhang' }
  | { type: 'swing/tick'; dtMs: number }
  | { type: 'state/reset'; template?: LanternType };

export const PASTE_MAX = 100;
export const CANDLE_MIN_BRIGHTNESS = 0.8;
export const CANDLE_MAX_BRIGHTNESS = 1.0;
export const CANDLE_TARGET_BRIGHTNESS = 0.9;
export const CANDLE_FLICKER_PERIOD_MS = 500;
export const CANDLE_FLAME_HEIGHT = 12;
export const SWING_INITIAL_ANGLE = 15;
export const SWING_OMEGA = 2 * Math.PI * 0.8;
export const SWING_LAMBDA = 1.5;
export const SWING_MAX_STEP_MS = 16;
export const ROTATION_MAX_SPEED = 72; // 360 度 / 5 秒

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function createInitialState(template: LanternType = 'palace'): LanternState {
  const t = createTemplate(template);
  return {
    currentPhase: 'skeleton',
    lanternType: template,
    nodes: t.nodes,
    bambooStrips: t.connections,
    silkPanels: t.silkPanels,
    selectedColor: 'moonWhite',
    isAssembled: false,
    candle: { isLit: false, brightness: 0, flickerOffset: 0, flameHeight: 0 },
    rotationAngle: 0,
    rotationSpeed: 0,
    hanging: { isHanging: false, swingAngle: 0, swingVelocity: 0, hookId: '' },
    isNightMode: false,
  };
}

const litCandle = (candle: LanternState['candle']): LanternState['candle'] => ({
  ...candle,
  isLit: true,
  brightness: CANDLE_MIN_BRIGHTNESS,
  flameHeight: CANDLE_FLAME_HEIGHT,
});

export function reduce(state: LanternState, event: LanternEvent): LanternState {
  switch (event.type) {
    case 'phase/set':
      return { ...state, currentPhase: event.phase };

    case 'node/dragStart':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === event.nodeId ? { ...n, isDragging: true } : n,
        ),
      };

    case 'node/dragMove':
      // 增量累加到节点当前坐标，而不是用单次位移覆盖；仅拖拽中的节点响应。
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === event.nodeId && n.isDragging
            ? { ...n, x: n.x + event.dx, y: n.y + event.dy }
            : n,
        ),
      };

    case 'node/dragEnd':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === event.nodeId ? { ...n, isDragging: false } : n,
        ),
      };

    case 'strip/connect': {
      const nodeIds = new Set(state.nodes.map((n) => n.id));
      const strip: BambooStrip = {
        id: `user-strip-${state.bambooStrips.length}`,
        startNodeId: event.startNodeId,
        endNodeId: event.endNodeId,
        isConnected: nodeIds.has(event.startNodeId) && nodeIds.has(event.endNodeId),
        highlighted: false,
      };
      return { ...state, bambooStrips: [...state.bambooStrips, strip] };
    }

    case 'silk/selectColor':
      return { ...state, selectedColor: event.color };

    case 'silk/paste':
      // 进度与张力在既有值上累加并钳制到 [0,100]；脱离中的绸面重新裱糊时从零起算并复位脱离标记。
      return {
        ...state,
        silkPanels: state.silkPanels.map((p) => {
          if (p.id !== event.panelId) return p;
          const baseProgress = p.isDetached ? 0 : p.pastingProgress;
          const baseTension = p.isDetached ? 0 : p.tension;
          return {
            ...p,
            isDetached: false,
            color: state.selectedColor,
            pastingProgress: clamp(baseProgress + event.progressDelta, 0, PASTE_MAX),
            tension: clamp(baseTension + event.tensionDelta, 0, PASTE_MAX),
          };
        }),
      };

    case 'silk/detach':
      return {
        ...state,
        silkPanels: state.silkPanels.map((p) =>
          p.id === event.panelId
            ? { ...p, isDetached: true, pastingProgress: 0, tension: 0 }
            : p,
        ),
      };

    case 'frame/assemble':
      return { ...state, isAssembled: true, candle: litCandle(state.candle) };

    case 'candle/light':
      return { ...state, candle: litCandle(state.candle) };

    case 'candle/tick': {
      if (!state.candle.isLit) return state;
      const rate = Math.min(1, event.dtMs / CANDLE_FLICKER_PERIOD_MS) * 0.5;
      const noise = event.noise ?? 0;
      const brightness = clamp(
        state.candle.brightness +
          (CANDLE_TARGET_BRIGHTNESS - state.candle.brightness) * rate +
          noise,
        CANDLE_MIN_BRIGHTNESS,
        CANDLE_MAX_BRIGHTNESS,
      );
      return {
        ...state,
        candle: {
          ...state.candle,
          brightness,
          flickerOffset: state.candle.flickerOffset + event.dtMs / CANDLE_FLICKER_PERIOD_MS,
        },
      };
    }

    case 'display/setRotationSpeed':
      return { ...state, rotationSpeed: clamp(event.speed, 0, ROTATION_MAX_SPEED) };

    case 'display/rotate':
      return {
        ...state,
        rotationAngle: (state.rotationAngle + (state.rotationSpeed * event.dtMs) / 1000) % 360,
      };

    case 'lantern/hang':
      return {
        ...state,
        currentPhase: 'hanging',
        isNightMode: true,
        hanging: {
          isHanging: true,
          swingAngle: SWING_INITIAL_ANGLE,
          swingVelocity: 0,
          hookId: event.hookId,
        },
      };

    case 'lantern/unhang':
      return {
        ...state,
        isNightMode: false,
        hanging: { isHanging: false, swingAngle: 0, swingVelocity: 0, hookId: '' },
      };

    case 'swing/tick': {
      if (!state.hanging.isHanging) return state;
      // 阻尼简谐运动：θ'' = -ω²θ - 2λθ'，半隐式欧拉积分，内部细分步长保证稳定。
      let angle = state.hanging.swingAngle;
      let velocity = state.hanging.swingVelocity;
      let remaining = event.dtMs;
      while (remaining > 0) {
        const dt = Math.min(remaining, SWING_MAX_STEP_MS) / 1000;
        const acceleration = -SWING_OMEGA * SWING_OMEGA * angle - 2 * SWING_LAMBDA * velocity;
        velocity += acceleration * dt;
        angle += velocity * dt;
        remaining -= dt * 1000;
      }
      return {
        ...state,
        hanging: { ...state.hanging, swingAngle: angle, swingVelocity: velocity },
      };
    }

    case 'state/reset':
      return createInitialState(event.template ?? state.lanternType);
  }
}

export class LanternEngine {
  #state: LanternState;

  constructor(template: LanternType = 'palace') {
    this.#state = createInitialState(template);
  }

  dispatch(event: LanternEvent): LanternState {
    this.#state = reduce(this.#state, event);
    return this.#state;
  }

  getState(): LanternState {
    return this.#state;
  }
}
