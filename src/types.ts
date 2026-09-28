export type FlavorType = 'sour' | 'sweet' | 'bitter' | 'spicy' | 'salty';

export interface FlavorScores {
  sour: number;
  sweet: number;
  bitter: number;
  spicy: number;
  salty: number;
}

export interface Recipe {
  id: string;
  name: string;
  ingredients: string[];
  cookingTime: number;
  flavors: FlavorType[];
  flavorScores: FlavorScores;
  rating: number;
  createdAt: number;
}

export type SortOption = 'rating-desc' | 'rating-asc' | 'time-desc' | 'time-asc';

export const FLAVOR_LABELS: Record<FlavorType, string> = {
  sour: '酸',
  sweet: '甜',
  bitter: '苦',
  spicy: '辣',
  salty: '咸',
};

export const FLAVOR_COLORS: Record<FlavorType, string> = {
  sour: '#F39C12',
  sweet: '#FF6B9D',
  bitter: '#8B6914',
  spicy: '#E74C3C',
  salty: '#3498DB',
};
