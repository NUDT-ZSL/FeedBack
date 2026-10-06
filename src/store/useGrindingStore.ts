import { create } from 'zustand';
import { GrindingEngine, GrindingOp } from '@/logic/grindingEngine';
import { GrindingState, GritType, LightPosition, LIGHT_ANGLES } from '@/types';

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

const engine = new GrindingEngine(randomSeed());

const now = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export const useGrindingStore = create<GrindingState>((set) => {
  const apply = (op: GrindingOp) => {
    engine.step(op);
    set(engine.getState());
  };

  return {
    ...engine.getState(),
    lightAngle: 0,
    lightPosition: 'front',

    startGrinding: (grit: GritType) => {
      apply({ type: 'startGrinding', grit, time: now() });
    },

    updateGrinding: (force, direction, time, position) => {
      apply({
        type: 'grind',
        force,
        direction,
        time: time ?? now(),
        position,
      });
    },

    stopGrinding: () => {
      apply({ type: 'stopGrinding' });
    },

    startPolishing: () => {
      apply({ type: 'startPolishing', time: now() });
    },

    updatePolishing: (force, time) => {
      apply({ type: 'polish', force, time: time ?? now() });
    },

    stopPolishing: () => {
      apply({ type: 'stopPolishing' });
    },

    setLightPosition: (position: LightPosition) => {
      set({ lightPosition: position, lightAngle: LIGHT_ANGLES[position] });
    },

    reset: (seed?: number) => {
      const snapshot = engine.reset(seed ?? randomSeed());
      set({ ...snapshot, lightAngle: 0, lightPosition: 'front' });
    },
  };
});
