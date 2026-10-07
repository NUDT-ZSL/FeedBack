import { create } from 'zustand';
import type { StoreState } from './types';
import {
  createInitialState,
  defaultContext,
  addIngredient as mAddIngredient,
  addGrind as mAddGrind,
  createIncense as mCreateIncense,
  placeIncenseOnCenser as mPlace,
  ignite as mIgnite,
  tick as mTick,
  reset as mReset,
  DEFAULT_INCENSE_COLOR,
  type IncenseState,
  type MachineContext,
} from './incense/machine';

function toFlat(state: IncenseState) {
  const onCenser =
    state.phase === 'placed' || state.phase === 'burning' || state.phase === 'burnt';
  return {
    phase: state.phase,
    currentRecipe: state.currentRecipe,
    grindLevel: state.grindLevel,
    burntime: state.burntime,
    smokeParticles: state.smokeParticles,
    isBurning: state.isBurning,
    hasIncense: state.incense !== null,
    incenseColor: state.incense ? state.incense.color : DEFAULT_INCENSE_COLOR,
    incenseOnCenser: onCenser,
    aromaScore: state.aromaScore,
  };
}

let machineState: IncenseState = createInitialState();
let tickContext: MachineContext = defaultContext();

export const useStore = create<StoreState>((set) => {
  const apply = (next: IncenseState) => {
    machineState = next;
    set(toFlat(next));
  };

  return {
    ...toFlat(machineState),

    addIngredient: (name, grams, color) => {
      const result = mAddIngredient(machineState, name, grams, color);
      if (result.accepted) apply(result.state);
    },

    addGrind: (delta) => {
      const result = mAddGrind(machineState, delta);
      if (result.accepted) apply(result.state);
    },

    createIncense: () => {
      const result = mCreateIncense(machineState);
      if (result.accepted) apply(result.state);
    },

    placeIncenseOnCenser: () => {
      const result = mPlace(machineState);
      if (result.accepted) apply(result.state);
    },

    ignite: () => {
      const result = mIgnite(machineState);
      if (result.accepted) apply(result.state);
    },

    tick: () => {
      const result = mTick(machineState, { ...tickContext, now: Date.now() });
      if (result.accepted) apply(result.state);
    },

    reset: () => {
      tickContext = defaultContext();
      apply(mReset());
    },
  };
});
