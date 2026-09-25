// Shared game rules used by both the browser game (main.ts) and the
// headless simulation (headlessGame.ts). Keeping them in one place
// guarantees the offline verification exercises the same numbers the
// player experiences.

export const MAX_STROKES = 10;
export const MAX_CHARGE_TIME_MS = 2000;
export const MIN_POWER = 2;
export const POWER_RANGE = 12;

// Power grows linearly with charge time, clamped at full charge.
export function chargePower(chargeMs: number): number {
  return Math.min(chargeMs / MAX_CHARGE_TIME_MS, 1) * POWER_RANGE + MIN_POWER;
}
