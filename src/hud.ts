export interface HUDState {
  fps: number;
  fishCount: number;
  coralCount: number;
}

/**
 * Writes FPS / fish count / coral count into the HUD DOM elements.
 * Extracted from main.ts so HUD consistency can be verified headlessly.
 */
export function updateHUD(doc: Document, state: HUDState): void {
  const fpsEl = doc.getElementById('fps');
  const fishEl = doc.getElementById('fish-count');
  const coralEl = doc.getElementById('coral-count');
  if (fpsEl) fpsEl.textContent = Math.round(state.fps).toString();
  if (fishEl) fishEl.textContent = state.fishCount.toString();
  if (coralEl) coralEl.textContent = state.coralCount.toString();
}
