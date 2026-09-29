export interface CanvasSize {
  width: number
  height: number
}

/**
 * Maps a CSS display size to the canvas backing-store size, honoring the
 * device pixel ratio so drawings are never stretched or cropped by CSS
 * scaling. Always returns integers >= 1.
 */
export function computeCanvasSize(cssWidth: number, cssHeight: number, dpr = 1): CanvasSize {
  const safeDpr = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  return {
    width: Math.max(1, Math.round(cssWidth * safeDpr)),
    height: Math.max(1, Math.round(cssHeight * safeDpr)),
  }
}
