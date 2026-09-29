export type PlantCategory = 'succulent' | 'green' | 'flowering' | 'cactus' | 'fern';
export type CareType = 'water' | 'fertilize' | 'prune' | 'repot' | 'other';
export type Difficulty = 1 | 2 | 3;

export interface Plant {
  id: string;
  name: string;
  category: PlantCategory;
  purchaseDate: string;
  difficulty: Difficulty;
  image?: string;
  nextWateringDate?: string;
  nextFertilizingDate?: string;
  createdAt: string;
  healthScore?: number;
}

export interface CareRecord {
  id: string;
  plantId: string;
  type: CareType;
  note?: string;
  date: string;
}

export interface Reminder {
  plantId: string;
  plantName: string;
  type: 'water' | 'fertilize';
  dueDate: string;
  daysOverdue: number;
}

export const categoryConfig: Record<PlantCategory, { label: string; color: string; icon: string }> = {
  succulent: { label: '多肉', color: '#88B04B', icon: '🌵' },
  green: { label: '绿植', color: '#6B8E23', icon: '🌿' },
  flowering: { label: '开花', color: '#FF6B6B', icon: '🌸' },
  cactus: { label: '仙人掌', color: '#2E8B57', icon: '🌵' },
  fern: { label: '蕨类', color: '#8FBC8F', icon: '🍃' },
};

export const careTypeConfig: Record<CareType, { label: string; color: string }> = {
  water: { label: '浇水', color: '#4FC3F7' },
  fertilize: { label: '施肥', color: '#FFB74D' },
  prune: { label: '修剪', color: '#81C784' },
  repot: { label: '换盆', color: '#BA68C8' },
  other: { label: '其他', color: '#90A4AE' },
};

export const difficultyStars: Record<Difficulty, string> = {
  1: '⭐',
  2: '⭐⭐',
  3: '⭐⭐⭐',
};
