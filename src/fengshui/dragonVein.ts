export const DRAGON_VEIN_HEIGHT_THRESHOLD = 100;

export type TerrainKind = "dragon" | "water";

export interface DragonVeinJudgment {
  kind: TerrainKind;
  label: "龙脉" | "水局";
  threshold: number;
  height: number;
  themes: readonly string[];
}

export const DRAGON_THEMES = [
  "龙脉走势",
  "靠山方位",
  "案山朝向",
  "玄武垂头",
] as const;

export const WATER_THEMES = [
  "水口方位",
  "来水去处",
  "水局格局",
  "明堂水势",
] as const;

export function judgeDragonVein(height: number): DragonVeinJudgment {
  if (height > DRAGON_VEIN_HEIGHT_THRESHOLD) {
    return {
      kind: "dragon",
      label: "龙脉",
      threshold: DRAGON_VEIN_HEIGHT_THRESHOLD,
      height,
      themes: DRAGON_THEMES,
    };
  }
  return {
    kind: "water",
    label: "水局",
    threshold: DRAGON_VEIN_HEIGHT_THRESHOLD,
    height,
    themes: WATER_THEMES,
  };
}
