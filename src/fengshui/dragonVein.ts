export const DRAGON_VEIN_HEIGHT_THRESHOLD = 100;

export type DragonVeinTrend = "mountain" | "water";

export function judgeDragonVein(height: number): DragonVeinTrend {
  return height > DRAGON_VEIN_HEIGHT_THRESHOLD ? "mountain" : "water";
}
