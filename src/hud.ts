/**
 * HUD helpers shared by main.ts and gui.ts. They depend only on a minimal
 * getElementById contract, so tests can drive them with a fake document.
 */

export interface HUDElementLike {
  textContent: string | null;
}

export interface HUDDocumentLike {
  getElementById(id: string): HUDElementLike | null;
}

/** Default water parameters; must match EnvironmentManager's initial params. */
export const DEFAULT_WATER_PARAMS = {
  temperature: 25,
  lightIntensity: 80,
  turbidity: 10,
} as const;

export function setHUDField(doc: HUDDocumentLike, id: string, value: string): void {
  const el = doc.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

export function formatTemperature(value: number): string {
  return value.toFixed(1);
}

export interface HUDStats {
  fps: number;
  fishCount: number;
  coralCount: number;
}

export function updateHUD(doc: HUDDocumentLike, stats: HUDStats): void {
  setHUDField(doc, 'fps', Math.round(stats.fps).toString());
  setHUDField(doc, 'fish-count', stats.fishCount.toString());
  setHUDField(doc, 'coral-count', stats.coralCount.toString());
}
