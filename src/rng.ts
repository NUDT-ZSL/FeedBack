export type RandomSource = () => number;

/**
 * Deterministic PRNG (mulberry32). Browser code keeps Math.random by default,
 * while tests inject either this seeded source or an arbitrary stub.
 */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
