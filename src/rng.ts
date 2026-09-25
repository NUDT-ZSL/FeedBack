// Seedable random source shared by gameplay code.
//
// By default `random()` simply forwards to `Math.random()`, so the game
// behaves exactly as before. Tests (or any offline tool) can install a
// deterministic source with `seedRandom(seed)` to make terrain generation
// and slope deviation fully reproducible.

export type RandomSource = () => number;

let currentSource: RandomSource = Math.random;

/** Returns the next random number in [0, 1) from the active source. */
export function random(): number {
  return currentSource();
}

/** Installs a custom random source (used by tests / simulations). */
export function setRandomSource(source: RandomSource): void {
  currentSource = source;
}

/** Restores the default non-deterministic source (Math.random). */
export function resetRandomSource(): void {
  currentSource = Math.random;
}

/**
 * mulberry32: small, fast, deterministic PRNG.
 * Given the same seed it always produces the same sequence.
 */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Installs a deterministic random source for the given seed and returns it.
 * Call `resetRandomSource()` (or use try/finally) when done.
 */
export function seedRandom(seed: number): RandomSource {
  const source = mulberry32(seed);
  setRandomSource(source);
  return source;
}
