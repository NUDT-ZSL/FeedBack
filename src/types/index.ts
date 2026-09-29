export type ClothingCategory = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'accessory';

export type StyleTag = '休闲' | '通勤' | '运动' | '复古' | '街头';

export interface ClothingItem {
  id: string;
  name: string;
  category: ClothingCategory;
  color: string;
  styleTags: StyleTag[];
  photoUrl?: string;
  createdAt: number;
}

export interface OutfitRecord {
  id: string;
  date: string;
  topId?: string;
  bottomId?: string;
  outerwearId?: string;
  shoesId?: string;
  accessoryIds: string[];
  rating: number;
  note: string;
  createdAt: number;
}

export interface OutfitRecommendation {
  id: string;
  items: ClothingItem[];
  reason: string;
  score: number;
}

export const COLOR_PALETTE: string[] = [
  '#FFFFFF', '#000000', '#808080', '#C0C0C0',
  '#FF0000', '#FF69B4', '#FFA500', '#FFD700',
  '#FFFF00', '#90EE90', '#00FF00', '#00CED1',
  '#4169E1', '#8A2BE2', '#8B4513', '#F5DEB3',
];

export const STYLE_TAGS: StyleTag[] = ['休闲', '通勤', '运动', '复古', '街头'];

export const CATEGORY_LABELS: Record<ClothingCategory, string> = {
  top: '上衣',
  bottom: '下装',
  outerwear: '外套',
  shoes: '鞋',
  accessory: '配饰',
};

export const CATEGORY_COLORS: Record<ClothingCategory, string> = {
  top: '#4A90D9',
  bottom: '#50C878',
  outerwear: '#E67E22',
  shoes: '#9B59B6',
  accessory: '#F1C40F',
};
