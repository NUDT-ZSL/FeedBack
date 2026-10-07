import { create } from 'zustand';
import { GrindingState, GritType, LightPosition, LIGHT_ANGLES } from '@/types';
import { createGrindingEngine, GrindingEngine } from '@/simulation/grindingEngine';

/**
 * 界面层状态容器：不再承载任何演进逻辑，
 * 只负责把用户操作翻译成引擎事件（带上当前时钟），并把引擎快照同步给组件。
 * 演进规则见 src/simulation/grindingEngine.ts，可离线重放与断言。
 */
const randomSeed = () => Math.floor(Math.random() * 0xffffffff);

const engine: GrindingEngine = createGrindingEngine(randomSeed());

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const useGrindingStore = create<GrindingState>((set) => {
  const sync = () => set(engine.getState());

  return {
    ...engine.getState(),
    lightAngle: 0,
    lightPosition: 'front',

    startGrinding: (grit: GritType) => {
      engine.apply({ kind: 'startGrinding', time: now(), grit });
      sync();
    },

    updateGrinding: (force, direction, position) => {
      const result = engine.apply({
        kind: 'grind',
        time: now(),
        force,
        direction,
        x: position?.x,
        y: position?.y,
      });
      sync();
      return result.effects;
    },

    stopGrinding: () => {
      engine.apply({ kind: 'stopGrinding', time: now() });
      sync();
    },

    startPolishing: () => {
      engine.apply({ kind: 'startPolishing', time: now() });
      sync();
    },

    updatePolishing: (force) => {
      const result = engine.apply({ kind: 'polish', time: now(), force });
      sync();
      return result.effects;
    },

    stopPolishing: () => {
      engine.apply({ kind: 'stopPolishing', time: now() });
      sync();
    },

    setLightPosition: (position: LightPosition) => {
      set({ lightPosition: position, lightAngle: LIGHT_ANGLES[position] });
    },

    reset: () => {
      engine.reset(randomSeed());
      set({ ...engine.getState(), lightAngle: 0, lightPosition: 'front' });
    },
  };
});
