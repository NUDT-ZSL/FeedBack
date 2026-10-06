import { create } from 'zustand';
import type { StoreState } from './types';
import * as machine from './state/machine.ts';

const extract = (state: StoreState): machine.WorkshopState => ({
  currentRecipe: state.currentRecipe,
  grindLevel: state.grindLevel,
  hasIncense: state.hasIncense,
  incenseColor: state.incenseColor,
  incenseOnCenser: state.incenseOnCenser,
  isBurning: state.isBurning,
  burntime: state.burntime,
  aromaScore: state.aromaScore,
  smokeParticles: state.smokeParticles,
  nextParticleId: state.nextParticleId,
});

export const useStore = create<StoreState>((set, get) => {
  const apply = (transition: (state: machine.WorkshopState) => machine.WorkshopState) =>
    set(transition(extract(get())));

  return {
    ...machine.initialState(),

    addIngredient: (name: string, grams: number, color: string) =>
      apply(state => machine.addIngredient(state, name, grams, color)),

    setGrind: (level: number) =>
      apply(state => machine.setGrind(state, level)),

    createIncense: () =>
      apply(state => machine.createIncense(state)),

    placeIncenseOnCenser: () =>
      apply(state => machine.placeIncenseOnCenser(state)),

    ignite: () =>
      apply(state => machine.ignite(state)),

    tick: () =>
      apply(state => machine.tick(state)),

    reset: () => set(machine.reset()),
  };
});
