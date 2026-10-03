export interface RandomSource {
  next(): number;
}

export const systemRandom: RandomSource = {
  next: () => Math.random()
};

export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
}

export function floatBetween(random: RandomSource, min: number, max: number): number {
  return min + random.next() * (max - min);
}

export function intBetween(random: RandomSource, min: number, max: number): number {
  return Math.floor(floatBetween(random, min, max + 1));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
