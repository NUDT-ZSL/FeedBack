import { create } from 'zustand';
import {
  createMatch,
  setKey as simSetKey,
  startCharge as simStartCharge,
  shoot as simShoot,
  pass as simPass,
  tackle as simTackle,
  step,
  chargePowerAt,
} from './sim';
import type { SimState } from './sim';

interface GameStore {
  sim: SimState | null;
  selectedTemplateId: string | null;

  selectPlayer: (templateId: string) => void;
  startGame: (seed?: number) => void;
  setKey: (key: string, pressed: boolean) => void;
  startCharge: () => void;
  updateCharge: () => void;
  shoot: () => void;
  pass: () => void;
  tackle: () => void;
  update: (deltaTime: number) => void;
  triggerRandomEvent: () => void;
  resetGame: () => void;
  addFootprint: (x: number, y: number) => void;
  generateConfetti: () => void;
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

export const useGameStore = create<GameStore>((set, get) => ({
  sim: null,
  selectedTemplateId: null,

  selectPlayer: (templateId) => set({ selectedTemplateId: templateId }),

  startGame: (seed) => {
    const { selectedTemplateId } = get();
    if (!selectedTemplateId) return;
    set({ sim: createMatch(seed ?? randomSeed(), selectedTemplateId) });
  },

  setKey: (key, pressed) => {
    const { sim } = get();
    if (!sim) return;
    set({ sim: simSetKey(sim, key, pressed) });
  },

  startCharge: () => {
    const { sim } = get();
    if (!sim) return;
    set({ sim: simStartCharge(sim) });
  },

  updateCharge: () => {
    const { sim } = get();
    if (!sim || !sim.isCharging) return;
    set({ sim: { ...sim, shotPower: chargePowerAt(sim.clock, sim.chargeStartClock) } });
  },

  shoot: () => {
    const { sim } = get();
    if (!sim) return;
    set({ sim: simShoot(sim) });
  },

  pass: () => {
    const { sim } = get();
    if (!sim) return;
    set({ sim: simPass(sim) });
  },

  tackle: () => {
    const { sim } = get();
    if (!sim) return;
    set({ sim: simTackle(sim) });
  },

  update: (deltaTime) => {
    const { sim } = get();
    if (!sim) return;
    set({ sim: step(sim, deltaTime) });
  },

  triggerRandomEvent: () => {
    const { sim } = get();
    if (!sim) return;
    set({ sim: { ...sim, nextEventAt: sim.clock } });
  },

  resetGame: () => set({ sim: null }),

  addFootprint: () => {},
  generateConfetti: () => {},
}));
