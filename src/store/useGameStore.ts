import { create } from 'zustand';
import { GameState, CatapultType, AmmoType } from '../game/types';

interface GameStore extends GameState {
  engine: any | null;
  setEngine: (engine: any) => void;
  setState: (state: Partial<GameState>) => void;
  startDragCatapult: (type: CatapultType, x: number, y: number) => void;
  updateDragPosition: (x: number, y: number) => void;
  endDragCatapult: (x: number, y: number) => void;
  startBattle: () => void;
  selectCatapult: (id: string) => void;
  deselectCatapult: () => void;
  startAiming: (x: number, y: number) => void;
  updateAim: (x: number, y: number) => void;
  fireSelectedCatapult: () => void;
  setAmmoType: (catapultId: string, type: AmmoType) => void;
  repairCatapult: (catapultId: string) => void;
  endPlayerTurn: () => void;
  restartGame: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'deploy',
  turn: 1,
  catapults: [],
  wall: {
    durability: 500,
    maxDurability: 500,
    morale: 100,
    maxMorale: 100,
    crackLevel: [0, 0, 0, 0, 0],
  },
  ammo: { stone: 15, fire: 8 },
  particles: [],
  projectiles: [],
  deployedSlots: [null, null, null],
  selectedCatapult: null,
  isAiming: false,
  trajectoryPoints: [],
  draggingCatapult: null,
  engine: null,

  setEngine: (engine) => set({ engine }),

  setState: (state) => set(state),

  startDragCatapult: (type, x, y) => {
    const { engine } = get();
    engine?.startDragCatapult(type, x, y);
  },

  updateDragPosition: (x, y) => {
    const { engine } = get();
    engine?.updateDragPosition(x, y);
  },

  endDragCatapult: (x, y) => {
    const { engine } = get();
    engine?.endDragCatapult(x, y);
  },

  startBattle: () => {
    const { engine } = get();
    engine?.startBattle();
  },

  selectCatapult: (id) => {
    const { engine } = get();
    engine?.selectCatapult(id);
  },

  deselectCatapult: () => {
    const { engine } = get();
    engine?.deselectCatapult();
  },

  startAiming: (x, y) => {
    const { engine } = get();
    engine?.startAiming(x, y);
  },

  updateAim: (x, y) => {
    const { engine } = get();
    engine?.updateAim(x, y);
  },

  fireSelectedCatapult: () => {
    const { engine } = get();
    engine?.fireSelectedCatapult();
  },

  setAmmoType: (catapultId, type) => {
    const { engine } = get();
    engine?.setAmmoType(catapultId, type);
  },

  repairCatapult: (catapultId) => {
    const { engine } = get();
    engine?.repairCatapult(catapultId);
  },

  endPlayerTurn: () => {
    const { engine } = get();
    engine?.endPlayerTurn();
  },

  restartGame: () => {
    const { engine } = get();
    engine?.restartGame();
  },
}));
