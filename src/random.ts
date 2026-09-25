export type RandomSource = () => number;

export const defaultRandom: RandomSource = () => Math.random();

/**
 * Deterministic PRNG (mulberry32). The same seed always produces the same
 * sequence, which makes angle jitter, colors, particles and chain rolls
 * reproducible outside the browser.
 */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;

  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;

    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
