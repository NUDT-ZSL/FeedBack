export type PlantSpecies = 'cactus' | 'sunflower' | 'succulent';

export type PlantStage = 'seed' | 'sprout' | 'adult' | 'flowering';

export type DiaryEntryType = 'water' | 'fertilize' | 'light' | 'stage' | 'create';

export type NotificationType = 'water' | 'fertilize' | 'friend' | 'stage' | 'system';

export interface User {
  id: string;
  username: string;
  avatar: string;
  friends?: string[];
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

export interface DiaryEntry {
  id: string;
  plantId: string;
  timestamp: number;
  type: DiaryEntryType;
  description: string;
}

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

export interface WSMessage<T = unknown> {
  type: 'subscribe' | 'unsubscribe' | 'heartbeat' | 'plants_update' | 'notification' | 'leaderboard';
  userId?: string;
  targetUserId?: string;
  payload?: T;
}

export const STAGE_NAMES: Record<PlantStage, string> = {
  seed: '种子',
  sprout: '幼苗',
  adult: '成株',
  flowering: '开花',
};

export const SPECIES_ICONS: Record<PlantSpecies, string> = {
  cactus: '🌵',
  sunflower: '🌻',
  succulent: '🌿',
};

export const SPECIES_COLORS: Record<PlantSpecies, string> = {
  cactus: '#228B22',
  sunflower: '#FFD700',
  succulent: '#32CD32',
};
