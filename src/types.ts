export type OrderStatus = 'pending' | 'in-progress' | 'completed';

export type CakeSize = 6 | 8 | 10 | 12;

export type CakeFlavor = '原味' | '巧克力' | '抹茶' | '红丝绒' | '芒果';

export interface Order {
  id: string;
  size: CakeSize;
  layers: number;
  flavor: CakeFlavor;
  decorationNote: string;
  status: OrderStatus;
  submittedAt: Date;
  startedAt?: Date;
  estimatedDuration?: number;
}

export type IngredientName = '面粉' | '糖' | '黄油' | '鸡蛋' | '奶油' | '可可粉' | '抹茶粉' | '芒果果泥';

export interface Ingredient {
  id: string;
  name: IngredientName;
  initialStock: number;
  consumed: number;
  unit: 'g' | '个';
}

export interface RecipeEntry {
  ingredient: IngredientName;
  amount: number;
}
