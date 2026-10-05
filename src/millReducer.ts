import type { AnimatingBag, MillAction } from './types';
import {
  createLedger,
  pack,
  restoreBatches,
  setGap,
  setValve,
  tick,
  type MillLedger,
} from './MillCore';

export interface MillUIState {
  ledger: MillLedger;
  /** 动画袋与批次共用同一 id，保证一一对应 */
  animatingBags: AnimatingBag[];
  /** 罗筛振动相位，0-1 循环 */
  sieveProgress: number;
}

export const createInitialState = (): MillUIState => ({
  ledger: createLedger(),
  animatingBags: [],
  sieveProgress: 0,
});

export const millReducer = (
  state: MillUIState,
  action: MillAction
): MillUIState => {
  switch (action.type) {
    case 'SET_VALVE':
      return { ...state, ledger: setValve(state.ledger, action.payload) };
    case 'SET_GAP':
      return { ...state, ledger: setGap(state.ledger, action.payload) };
    case 'TICK': {
      const dt = action.payload;
      const ledger = tick(state.ledger, dt);
      const sieveProgress =
        ledger.speed > 0 && !ledger.overloaded
          ? (state.sieveProgress + dt * 1.2) % 1
          : state.sieveProgress;
      return { ...state, ledger, sieveProgress };
    }
    case 'PACK': {
      const { ledger, batch } = pack(state.ledger, action.payload, Date.now());
      if (!batch) return state;
      const bag: AnimatingBag = {
        id: batch.id,
        type: batch.type,
        weight: batch.weight,
      };
      return {
        ...state,
        ledger,
        animatingBags: [...state.animatingBags, bag],
      };
    }
    case 'LOAD_BATCHES':
      return { ...state, ledger: restoreBatches(state.ledger, action.payload) };
    case 'REMOVE_BAG_ANIMATION':
      return {
        ...state,
        animatingBags: state.animatingBags.filter((b) => b.id !== action.payload),
      };
    default:
      return state;
  }
};
