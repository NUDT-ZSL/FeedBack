export type IngredientCategory = 'vegetable' | 'meat' | 'seasoning' | 'grain' | 'dairy' | 'other';

export interface Ingredient {
  name: string;
  amount: number;
  unit: string;
  category: IngredientCategory;
}

export interface CookingStep {
  order: number;
  description: string;
}

export interface Recipe {
  id: string;
  name: string;
  ingredients: Ingredient[];
  steps: CookingStep[];
  seasonings: Ingredient[];
  cookTime: number;
  difficulty: 'easy' | 'medium' | 'hard';
  cuisine: string;
  createdAt: number;
}

export interface ShoppingItem {
  id: string;
  name: string;
  amount: number;
  unit: string;
  category: IngredientCategory;
  checked: boolean;
  sourceRecipes: string[];
}

export interface Favorite {
  recipeId: string;
  order: number;
  addedAt: number;
}

export interface FridgeRecommendation {
  recipe: Recipe;
  matchScore: number;
  matchedIngredients: string[];
}

export type TabKey = 'recipes' | 'shopping' | 'fridge' | 'favorites';

export const CATEGORY_LABELS: Record<IngredientCategory, string> = {
  vegetable: '蔬菜',
  meat: '肉类',
  seasoning: '调味品',
  grain: '谷薯豆类',
  dairy: '蛋奶乳品',
  other: '其他食材',
};

export const CATEGORY_COLORS: Record<IngredientCategory, string> = {
  vegetable: '#6B8E23',
  meat: '#CD5C5C',
  seasoning: '#9370DB',
  grain: '#DAA520',
  dairy: '#B0C4DE',
  other: '#9E9E9E',
};

export const DIFFICULTY_LABELS = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
} as const;

export const CUISINE_OPTIONS = ['家常菜', '川菜', '粤菜', '浙菜', '湘菜', '素菜', '蒸菜', '汤品', '早餐', '其他'];

export const UNIT_OPTIONS = ['克', '毫升', '个', '根', '片', '颗', '瓣', '勺', '把', '块'];
