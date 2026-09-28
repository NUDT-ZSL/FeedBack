import type { Order, Ingredient, CakeSize, CakeFlavor, IngredientName } from './types';

export const initialOrders: Order[] = [
  {
    id: '1',
    size: 8,
    layers: 2,
    flavor: '巧克力',
    decorationNote: '祝妈妈生日快乐，需要巧克力淋面装饰',
    status: 'pending',
    submittedAt: new Date(Date.now() - 3600000),
  },
  {
    id: '2',
    size: 10,
    layers: 1,
    flavor: '芒果',
    decorationNote: '宝宝百天庆祝，添加新鲜芒果装饰',
    status: 'pending',
    submittedAt: new Date(Date.now() - 7200000),
  },
  {
    id: '3',
    size: 6,
    layers: 1,
    flavor: '原味',
    decorationNote: '简单奶油裱花，写"生日快乐"',
    status: 'completed',
    submittedAt: new Date(Date.now() - 86400000),
  },
];

export const initialIngredients: Ingredient[] = [
  { id: '1', name: '面粉', initialStock: 5000, consumed: 0, unit: 'g' },
  { id: '2', name: '糖', initialStock: 3000, consumed: 0, unit: 'g' },
  { id: '3', name: '黄油', initialStock: 2000, consumed: 0, unit: 'g' },
  { id: '4', name: '鸡蛋', initialStock: 100, consumed: 0, unit: '个' },
  { id: '5', name: '奶油', initialStock: 4000, consumed: 0, unit: 'g' },
  { id: '6', name: '可可粉', initialStock: 500, consumed: 0, unit: 'g' },
  { id: '7', name: '抹茶粉', initialStock: 300, consumed: 0, unit: 'g' },
  { id: '8', name: '芒果果泥', initialStock: 1000, consumed: 0, unit: 'g' },
];

const baseRecipe: Record<IngredientName, number> = {
  '面粉': 150,
  '糖': 100,
  '黄油': 80,
  '鸡蛋': 4,
  '奶油': 200,
  '可可粉': 0,
  '抹茶粉': 0,
  '芒果果泥': 0,
};

const sizeMultiplier: Record<CakeSize, number> = {
  6: 1,
  8: 1.5,
  10: 2.25,
  12: 3.375,
};

const flavorAdjustments: Record<CakeFlavor, Partial<Record<IngredientName, number>>> = {
  '巧克力': { '可可粉': 30, '面粉': -20 },
  '抹茶': { '抹茶粉': 15, '面粉': -10 },
  '芒果': { '芒果果泥': 100, '奶油': -50 },
  '红丝绒': { '可可粉': 10, '面粉': -10 },
  '原味': {},
};

export function calculateIngredients(size: CakeSize, flavor: CakeFlavor): Record<IngredientName, number> {
  const multiplier = sizeMultiplier[size];
  const adjustments = flavorAdjustments[flavor];
  const result: Record<IngredientName, number> = {} as Record<IngredientName, number>;
  
  (Object.keys(baseRecipe) as IngredientName[]).forEach(name => {
    let amount = baseRecipe[name] * multiplier;
    if (adjustments[name] !== undefined) {
      amount += adjustments[name]!;
    }
    result[name] = Math.round(amount * 10) / 10;
  });
  
  return result;
}

export function calculateDuration(layers: number): number {
  const baseTime = 120;
  const perLayer = 30;
  return baseTime + (layers - 1) * perLayer;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}
