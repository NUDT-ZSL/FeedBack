// Seedable deterministic RNG (mulberry32). All animation randomness flows
// through here so offline verification can reproduce exact runs.
let state = 0x9e3779b9;

export const setRandomSeed = (seed: number): void => {
  state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
};

export const random = (): number => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
