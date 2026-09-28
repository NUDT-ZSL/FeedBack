import type { PlantSpecies, PlantStage } from './types';

export const SPECIES_ICONS: Record<PlantSpecies, string> = {
  cactus: '🌵',
  sunflower: '🌻',
  succulent: '🌿',
};

export const STAGE_NAMES: Record<PlantStage, string> = {
  seed: '种子',
  sprout: '幼苗',
  adult: '成株',
  flowering: '开花',
};

export const SPECIES_COLORS: Record<PlantSpecies, string> = {
  cactus: '#228B22',
  sunflower: '#FFD700',
  succulent: '#32CD32',
};

export const SPECIES_DETAIL_COLORS: Record<PlantSpecies, { stem: string; leaf: string; flower: string }> = {
  cactus: { stem: '#228B22', leaf: '#2E8B57', flower: '#FF69B4' },
  sunflower: { stem: '#228B22', leaf: '#32CD32', flower: '#FFD700' },
  succulent: { stem: '#32CD32', leaf: '#3CB371', flower: '#FF6347' },
};

export const HEALTH_COLORS = {
  water: '#3B82F6',
  light: '#EAB308',
  nutrition: '#22C55E',
  danger: '#EF4444',
};
