export type PlantSpecies = 'cactus' | 'sunflower' | 'succulent';

export type PlantStage = 'seed' | 'sprout' | 'adult' | 'flowering';

export enum PlantStatus {
  HEALTHY = 'healthy',
  NEEDS_WATER = 'needs_water',
  NEEDS_LIGHT = 'needs_light',
  NEEDS_NUTRITION = 'needs_nutrition',
  CRITICAL = 'critical',
}

export enum GrowthStage {
  SEED = 0,
  SPROUT = 1,
  ADULT = 2,
  FLOWERING = 3,
}

export const STAGE_DURATION_MINUTES = 5;

export const GROWTH_STAGE_THRESHOLDS: Record<PlantStage, number> = {
  seed: 0,
  sprout: 25,
  adult: 50,
  flowering: 75,
};

export const STAGE_NAMES: Record<PlantStage, string> = {
  seed: '种子',
  sprout: '幼苗',
  adult: '成株',
  flowering: '开花',
};

export interface PlantGrowthConfig {
  seedToSprout: number;
  sproutToAdult: number;
  adultToFlowering: number;
  baseGrowthRate: number;
  icon: string;
  color: string;
}

export const PLANT_GROWTH_CONFIG: Record<PlantSpecies, PlantGrowthConfig> = {
  cactus: {
    seedToSprout: 25,
    sproutToAdult: 50,
    adultToFlowering: 75,
    baseGrowthRate: 5,
    icon: '🌵',
    color: '#228B22',
  },
  sunflower: {
    seedToSprout: 25,
    sproutToAdult: 50,
    adultToFlowering: 75,
    baseGrowthRate: 5,
    icon: '🌻',
    color: '#FFD700',
  },
  succulent: {
    seedToSprout: 25,
    sproutToAdult: 50,
    adultToFlowering: 75,
    baseGrowthRate: 5,
    icon: '🌿',
    color: '#32CD32',
  },
};

export function calculateGrowthStage(createdAt: number, now: number = Date.now()): PlantStage {
  const elapsedMinutes = (now - createdAt) / (1000 * 60);
  const stageIndex = Math.min(
    Math.floor(elapsedMinutes / STAGE_DURATION_MINUTES),
    Object.keys(GROWTH_STAGE).length / 2 - 1
  );

  const stageMap: Record<number, PlantStage> = {
    [GrowthStage.SEED]: 'seed',
    [GrowthStage.SPROUT]: 'sprout',
    [GrowthStage.ADULT]: 'adult',
    [GrowthStage.FLOWERING]: 'flowering',
  };

  return stageMap[stageIndex] || 'seed';
}

export function calculateProgress(createdAt: number, now: number = Date.now()): number {
  const elapsedMinutes = (now - createdAt) / (1000 * 60);
  const totalStages = Object.keys(GROWTH_STAGE).length / 2;
  const totalMinutes = totalStages * STAGE_DURATION_MINUTES;
  return Math.min(100, (elapsedMinutes / totalMinutes) * 100);
}

export function getPlantStatus(health: PlantHealth): PlantStatus {
  const { water, light, nutrition } = health;
  const critical = water < 20 || light < 20 || nutrition < 20;

  if (critical) {
    if (water < 20) return PlantStatus.NEEDS_WATER;
    if (light < 20) return PlantStatus.NEEDS_LIGHT;
    if (nutrition < 20) return PlantStatus.NEEDS_NUTRITION;
    return PlantStatus.CRITICAL;
  }

  return PlantStatus.HEALTHY;
}

export interface User {
  id: string;
  username: string;
  password: string;
  avatar: string;
  friends: string[];
}

export interface PlantHealth {
  water: number;
  light: number;
  nutrition: number;
}

export interface Plant {
  id: string;
  ownerId: string;
  species: PlantSpecies;
  name: string;
  stage: PlantStage;
  progress: number;
  health: PlantHealth;
  createdAt: number;
  lastWateredBy: Array<{ userId: string; username: string; timestamp: number }>;
  lastFertilizedBy: Array<{ userId: string; username: string; timestamp: number }>;
  lastHelpers: Array<{ userId: string; username: string; avatar: string; timestamp: number }>;
}

export type DiaryEntryType = 'water' | 'fertilize' | 'light' | 'stage' | 'create';

export interface DiaryEntry {
  id: string;
  plantId: string;
  timestamp: number;
  type: DiaryEntryType;
  description: string;
}

export type NotificationType = 'water' | 'fertilize' | 'friend' | 'stage' | 'system';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  message: string;
  timestamp: number;
  fromUserId: string;
  fromUsername: string;
  plantId?: string;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  avatar: string;
  totalScore: number;
  recentPlants: Plant[];
  previousRank?: number;
}

export interface WSMessage {
  type: 'subscribe' | 'unsubscribe' | 'heartbeat' | 'plants_update' | 'notification' | 'leaderboard';
  userId?: string;
  targetUserId?: string;
  payload?: unknown;
}
