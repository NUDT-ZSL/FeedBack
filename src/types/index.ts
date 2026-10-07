export interface User {
  id: string;
  username: string;
}

export interface Tea {
  id: string;
  user_id: string;
  name: string;
  category: string;
  origin: string;
  year: number;
  photo_path: string;
  created_at: string;
  avg_score?: number;
}

export interface TastingNote {
  id: string;
  tea_id: string;
  date: string;
  water_temp: number;
  tea_amount: number;
  brew_time: number;
  aroma: string;
  score: number;
  description: string;
  created_at: string;
}

export interface TeaWithNotes extends Tea {
  tasting_notes: TastingNote[];
}

export interface TeaFilters {
  category: string;
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
  origin: string;
}

export interface BrewParams {
  waterTemp: number;
  teaAmount: number;
  brewTime: number;
}

export const TEA_CATEGORIES = [
  { id: 'green', name: '绿茶', color: '#6b8e23', gradient: 'linear-gradient(135deg, #6b8e23 0%, #90EE90 100%)', icon: '🍃' },
  { id: 'black', name: '红茶', color: '#c0392b', gradient: 'linear-gradient(135deg, #c0392b 0%, #e74c3c 100%)', icon: '🍂' },
  { id: 'oolong', name: '乌龙茶', color: '#d4a373', gradient: 'linear-gradient(135deg, #d4a373 0%, #c19a6b 100%)', icon: '🫖' },
  { id: 'white', name: '白茶', color: '#f5f0e8', gradient: 'linear-gradient(135deg, #f5f0e8 0%, #e8dcc8 100%)', icon: '☁️' },
  { id: 'yellow', name: '黄茶', color: '#f1c40f', gradient: 'linear-gradient(135deg, #f1c40f 0%, #f39c12 100%)', icon: '🌾' },
  { id: 'dark', name: '黑茶', color: '#4a2c1a', gradient: 'linear-gradient(135deg, #4a2c1a 0%, #6b4423 100%)', icon: '🌰' },
];
