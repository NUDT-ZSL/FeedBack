export type Rng = () => number;

export interface Clock {
  now(): Date;
}

export function systemClock(): Clock {
  return { now: () => new Date() };
}

export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid fixed clock instant: ${iso}`);
  }
  return { now: () => new Date(instant.getTime()) };
}

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Deps {
  clock: Clock;
  rng: Rng;
}

export function createDeps(options: { seed?: number; clock?: Clock } = {}): Deps {
  return {
    clock: options.clock ?? systemClock(),
    rng: mulberry32(options.seed ?? 73),
  };
}
