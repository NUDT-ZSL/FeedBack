import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

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

const recipes: Map<string, Recipe> = new Map();
const favorites: Map<string, Favorite> = new Map();
const shareCodes: Map<string, string[]> = new Map();

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

class LRUCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number = 100, ttl: number = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value as K | undefined;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.cache.clear();
  }
}

const searchCache = new LRUCache<string, Recipe[]>();
const recommendCache = new LRUCache<string, FridgeRecommendation[]>();

const seedRecipes: Recipe[] = [
  {
    id: uuidv4(),
    name: '番茄炒蛋',
    ingredients: [
      { name: '番茄', amount: 2, unit: '个', category: 'vegetable' },
      { name: '鸡蛋', amount: 3, unit: '个', category: 'other' },
      { name: '葱花', amount: 5, unit: '克', category: 'vegetable' },
    ],
    steps: [
      { order: 1, description: '番茄切块，鸡蛋打散加少许盐' },
      { order: 2, description: '热油炒蛋，凝固后盛出' },
      { order: 3, description: '炒番茄出汁，加入鸡蛋翻炒' },
      { order: 4, description: '调味撒葱花出锅' },
    ],
    seasonings: [
      { name: '盐', amount: 3, unit: '克', category: 'seasoning' },
      { name: '白糖', amount: 5, unit: '克', category: 'seasoning' },
      { name: '食用油', amount: 15, unit: '毫升', category: 'seasoning' },
    ],
    cookTime: 15,
    difficulty: 'easy',
    cuisine: '家常菜',
    createdAt: Date.now() - 100000,
  },
  {
    id: uuidv4(),
    name: '红烧肉',
    ingredients: [
      { name: '五花肉', amount: 500, unit: '克', category: 'meat' },
      { name: '生姜', amount: 10, unit: '克', category: 'vegetable' },
      { name: '大葱', amount: 1, unit: '根', category: 'vegetable' },
      { name: '八角', amount: 2, unit: '颗', category: 'seasoning' },
    ],
    steps: [
      { order: 1, description: '五花肉切块焯水去血沫' },
      { order: 2, description: '炒糖色至枣红色' },
      { order: 3, description: '下肉块翻炒上色' },
      { order: 4, description: '加料酒酱油水，小火炖40分钟' },
      { order: 5, description: '大火收汁出锅' },
    ],
    seasonings: [
      { name: '生抽', amount: 20, unit: '毫升', category: 'seasoning' },
      { name: '老抽', amount: 10, unit: '毫升', category: 'seasoning' },
      { name: '料酒', amount: 30, unit: '毫升', category: 'seasoning' },
      { name: '冰糖', amount: 30, unit: '克', category: 'seasoning' },
    ],
    cookTime: 60,
    difficulty: 'medium',
    cuisine: '浙菜',
    createdAt: Date.now() - 200000,
  },
  {
    id: uuidv4(),
    name: '宫保鸡丁',
    ingredients: [
      { name: '鸡胸肉', amount: 300, unit: '克', category: 'meat' },
      { name: '花生米', amount: 50, unit: '克', category: 'grain' },
      { name: '干辣椒', amount: 10, unit: '个', category: 'vegetable' },
      { name: '黄瓜', amount: 1, unit: '根', category: 'vegetable' },
      { name: '葱白', amount: 20, unit: '克', category: 'vegetable' },
    ],
    steps: [
      { order: 1, description: '鸡肉切丁腌制15分钟' },
      { order: 2, description: '调宫保汁备用' },
      { order: 3, description: '热油滑炒鸡丁变白盛出' },
      { order: 4, description: '爆香干辣椒花椒' },
      { order: 5, description: '回锅鸡丁加黄瓜花生米，淋汁翻炒' },
    ],
    seasonings: [
      { name: '花椒', amount: 2, unit: '克', category: 'seasoning' },
      { name: '生抽', amount: 15, unit: '毫升', category: 'seasoning' },
      { name: '醋', amount: 10, unit: '毫升', category: 'seasoning' },
      { name: '白糖', amount: 10, unit: '克', category: 'seasoning' },
      { name: '淀粉', amount: 5, unit: '克', category: 'seasoning' },
    ],
    cookTime: 25,
    difficulty: 'medium',
    cuisine: '川菜',
    createdAt: Date.now() - 300000,
  },
  {
    id: uuidv4(),
    name: '蒜蓉西兰花',
    ingredients: [
      { name: '西兰花', amount: 400, unit: '克', category: 'vegetable' },
      { name: '大蒜', amount: 5, unit: '瓣', category: 'vegetable' },
    ],
    steps: [
      { order: 1, description: '西兰花切小朵盐水浸泡10分钟' },
      { order: 2, description: '焯水1分钟捞出过凉水' },
      { order: 3, description: '热油爆香蒜末' },
      { order: 4, description: '下西兰花快速翻炒调味' },
    ],
    seasonings: [
      { name: '盐', amount: 3, unit: '克', category: 'seasoning' },
      { name: '蚝油', amount: 10, unit: '克', category: 'seasoning' },
      { name: '食用油', amount: 15, unit: '毫升', category: 'seasoning' },
    ],
    cookTime: 10,
    difficulty: 'easy',
    cuisine: '素菜',
    createdAt: Date.now() - 400000,
  },
  {
    id: uuidv4(),
    name: '麻婆豆腐',
    ingredients: [
      { name: '嫩豆腐', amount: 400, unit: '克', category: 'other' },
      { name: '牛肉末', amount: 100, unit: '克', category: 'meat' },
      { name: '蒜苗', amount: 2, unit: '根', category: 'vegetable' },
    ],
    steps: [
      { order: 1, description: '豆腐切块焯水去豆腥' },
      { order: 2, description: '炒牛肉末至酥香' },
      { order: 3, description: '加豆瓣酱炒出红油' },
      { order: 4, description: '加水烧开下豆腐烧3分钟' },
      { order: 5, description: '勾芡撒花椒粉蒜苗' },
    ],
    seasonings: [
      { name: '郫县豆瓣酱', amount: 20, unit: '克', category: 'seasoning' },
      { name: '花椒粉', amount: 3, unit: '克', category: 'seasoning' },
      { name: '生抽', amount: 10, unit: '毫升', category: 'seasoning' },
      { name: '淀粉', amount: 5, unit: '克', category: 'seasoning' },
    ],
    cookTime: 20,
    difficulty: 'easy',
    cuisine: '川菜',
    createdAt: Date.now() - 500000,
  },
  {
    id: uuidv4(),
    name: '土豆炖牛肉',
    ingredients: [
      { name: '牛腩', amount: 500, unit: '克', category: 'meat' },
      { name: '土豆', amount: 2, unit: '个', category: 'vegetable' },
      { name: '胡萝卜', amount: 1, unit: '根', category: 'vegetable' },
      { name: '洋葱', amount: 0.5, unit: '个', category: 'vegetable' },
      { name: '番茄', amount: 1, unit: '个', category: 'vegetable' },
    ],
    steps: [
      { order: 1, description: '牛腩切块焯水洗净' },
      { order: 2, description: '爆香洋葱番茄出汁' },
      { order: 3, description: '加牛肉料酒香料水炖1小时' },
      { order: 4, description: '加土豆胡萝卜炖20分钟' },
      { order: 5, description: '大火收汁调味' },
    ],
    seasonings: [
      { name: '生抽', amount: 20, unit: '毫升', category: 'seasoning' },
      { name: '老抽', amount: 10, unit: '毫升', category: 'seasoning' },
      { name: '料酒', amount: 30, unit: '毫升', category: 'seasoning' },
      { name: '香叶', amount: 2, unit: '片', category: 'seasoning' },
      { name: '盐', amount: 5, unit: '克', category: 'seasoning' },
    ],
    cookTime: 90,
    difficulty: 'hard',
    cuisine: '家常菜',
    createdAt: Date.now() - 600000,
  },
  {
    id: uuidv4(),
    name: '鸡蛋羹',
    ingredients: [
      { name: '鸡蛋', amount: 2, unit: '个', category: 'other' },
      { name: '温水', amount: 150, unit: '毫升', category: 'other' },
      { name: '葱花', amount: 3, unit: '克', category: 'vegetable' },
    ],
    steps: [
      { order: 1, description: '鸡蛋打散加温水过筛' },
      { order: 2, description: '盖保鲜膜扎小孔' },
      { order: 3, description: '水开后中火蒸8分钟' },
      { order: 4, description: '淋生抽香油撒葱花' },
    ],
    seasonings: [
      { name: '生抽', amount: 5, unit: '毫升', category: 'seasoning' },
      { name: '香油', amount: 3, unit: '毫升', category: 'seasoning' },
      { name: '盐', amount: 1, unit: '克', category: 'seasoning' },
    ],
    cookTime: 15,
    difficulty: 'easy',
    cuisine: '蒸菜',
    createdAt: Date.now() - 700000,
  },
  {
    id: uuidv4(),
    name: '鱼香肉丝',
    ingredients: [
      { name: '猪里脊', amount: 300, unit: '克', category: 'meat' },
      { name: '胡萝卜', amount: 0.5, unit: '根', category: 'vegetable' },
      { name: '青椒', amount: 1, unit: '个', category: 'vegetable' },
      { name: '木耳', amount: 30, unit: '克', category: 'vegetable' },
      { name: '泡椒', amount: 10, unit: '克', category: 'vegetable' },
    ],
    steps: [
      { order: 1, description: '肉丝腌制上浆' },
      { order: 2, description: '调鱼香汁备用' },
      { order: 3, description: '滑炒肉丝变白盛出' },
      { order: 4, description: '炒香泡椒加蔬菜丝' },
      { order: 5, description: '回锅肉丝淋汁快速翻炒' },
    ],
    seasonings: [
      { name: '生抽', amount: 15, unit: '毫升', category: 'seasoning' },
      { name: '醋', amount: 15, unit: '毫升', category: 'seasoning' },
      { name: '白糖', amount: 15, unit: '克', category: 'seasoning' },
      { name: '淀粉', amount: 5, unit: '克', category: 'seasoning' },
    ],
    cookTime: 20,
    difficulty: 'medium',
    cuisine: '川菜',
    createdAt: Date.now() - 800000,
  },
];

seedRecipes.forEach((r) => recipes.set(r.id, r));

favorites.set(seedRecipes[0].id, { recipeId: seedRecipes[0].id, order: 0, addedAt: Date.now() - 50000 });
favorites.set(seedRecipes[1].id, { recipeId: seedRecipes[1].id, order: 1, addedAt: Date.now() - 40000 });
favorites.set(seedRecipes[3].id, { recipeId: seedRecipes[3].id, order: 2, addedAt: Date.now() - 30000 });

app.get('/api/recipes', (_req: Request, res: Response) => {
  const list = Array.from(recipes.values()).sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

app.get('/api/recipes/search', (req: Request, res: Response) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const cacheKey = q;

  if (searchCache.has(cacheKey)) {
    res.json(searchCache.get(cacheKey));
    return;
  }

  let results: Recipe[];
  if (!q) {
    results = Array.from(recipes.values()).sort((a, b) => b.createdAt - a.createdAt);
  } else {
    results = [];
    for (const r of recipes.values()) {
      if (r.name.toLowerCase().includes(q)) {
        results.push(r);
        continue;
      }
      if (r.ingredients.some((ing) => ing.name.toLowerCase().includes(q))) {
        results.push(r);
        continue;
      }
      if (r.cuisine.toLowerCase().includes(q)) {
        results.push(r);
      }
    }
  }

  searchCache.set(cacheKey, results);
  res.json(results);
});

app.get('/api/recipes/:id', (req: Request, res: Response) => {
  const r = recipes.get(req.params.id);
  if (!r) return res.status(404).json({ error: '食谱不存在' });
  res.json(r);
});

const clearAllCaches = () => {
  searchCache.clear();
  recommendCache.clear();
};

app.post('/api/recipes', (req: Request, res: Response) => {
  const body = req.body as Partial<Recipe>;
  if (!body.name || !body.ingredients) {
    return res.status(400).json({ error: '缺少必要字段' });
  }
  const recipe: Recipe = {
    id: uuidv4(),
    name: body.name,
    ingredients: body.ingredients || [],
    steps: body.steps || [],
    seasonings: body.seasonings || [],
    cookTime: body.cookTime || 15,
    difficulty: body.difficulty || 'easy',
    cuisine: body.cuisine || '家常菜',
    createdAt: Date.now(),
  };
  recipes.set(recipe.id, recipe);
  clearAllCaches();
  res.json(recipe);
});

app.put('/api/recipes/:id', (req: Request, res: Response) => {
  const existing = recipes.get(req.params.id);
  if (!existing) return res.status(404).json({ error: '食谱不存在' });
  const body = req.body as Partial<Recipe>;
  const updated: Recipe = { ...existing, ...body, id: existing.id, createdAt: existing.createdAt };
  recipes.set(existing.id, updated);
  clearAllCaches();
  res.json(updated);
});

app.delete('/api/recipes/:id', (req: Request, res: Response) => {
  if (!recipes.has(req.params.id)) return res.status(404).json({ error: '食谱不存在' });
  recipes.delete(req.params.id);
  favorites.delete(req.params.id);
  clearAllCaches();
  res.json({ success: true });
});

interface GenerateShoppingBody {
  recipeIds?: string[];
  selectedIngredients?: { recipeId: string; ingredientNames: string[] }[];
  manualItems?: Omit<ShoppingItem, 'id' | 'checked' | 'sourceRecipes'>[];
}

interface MergedIngredient {
  name: string;
  category: IngredientCategory;
  units: Map<string, { amount: number; sourceRecipes: Set<string> }>;
}

app.post('/api/shopping/generate', (req: Request, res: Response) => {
  const body = req.body as GenerateShoppingBody;
  const merged = new Map<string, MergedIngredient>();

  const addIngredient = (ing: Ingredient, sourceRecipeId: string) => {
    const key = ing.name.toLowerCase();
    let entry = merged.get(key);
    if (!entry) {
      entry = {
        name: ing.name,
        category: ing.category,
        units: new Map(),
      };
      merged.set(key, entry);
    }

    const unitKey = ing.unit;
    let unitEntry = entry.units.get(unitKey);
    if (!unitEntry) {
      unitEntry = { amount: 0, sourceRecipes: new Set() };
      entry.units.set(unitKey, unitEntry);
    }
    unitEntry.amount += ing.amount;
    unitEntry.sourceRecipes.add(sourceRecipeId);
  };

  if (body.selectedIngredients && body.selectedIngredients.length > 0) {
    for (const sel of body.selectedIngredients) {
      const r = recipes.get(sel.recipeId);
      if (!r) continue;
      const names = new Set(sel.ingredientNames.map((n) => n.toLowerCase()));
      for (const ing of r.ingredients) {
        if (names.has(ing.name.toLowerCase())) {
          addIngredient(ing, sel.recipeId);
        }
      }
    }
  } else if (body.recipeIds && body.recipeIds.length > 0) {
    for (const rid of body.recipeIds) {
      const r = recipes.get(rid);
      if (!r) continue;
      for (const ing of r.ingredients) {
        addIngredient(ing, rid);
      }
    }
  }

  if (body.manualItems) {
    for (const item of body.manualItems) {
      const key = item.name.toLowerCase();
      let entry = merged.get(key);
      if (!entry) {
        entry = {
          name: item.name,
          category: item.category as IngredientCategory,
          units: new Map(),
        };
        merged.set(key, entry);
      }

      const unitKey = item.unit;
      let unitEntry = entry.units.get(unitKey);
      if (!unitEntry) {
        unitEntry = { amount: 0, sourceRecipes: new Set() };
        entry.units.set(unitKey, unitEntry);
      }
      unitEntry.amount += item.amount;
    }
  }

  const list: ShoppingItem[] = [];
  const catOrder: IngredientCategory[] = ['vegetable', 'meat', 'grain', 'dairy', 'seasoning', 'other'];
  const sortedEntries = Array.from(merged.values()).sort((a, b) => {
    return catOrder.indexOf(a.category) - catOrder.indexOf(b.category);
  });

  for (const entry of sortedEntries) {
    const sortedUnits = Array.from(entry.units.entries()).sort((a, b) => b[1].amount - a[1].amount);
    for (const [unit, unitData] of sortedUnits) {
      list.push({
        id: uuidv4(),
        name: entry.name,
        amount: unitData.amount,
        unit: unit,
        category: entry.category,
        checked: false,
        sourceRecipes: Array.from(unitData.sourceRecipes),
      });
    }
  }

  res.json(list);
});

interface FridgeRecommendBody {
  ingredients: string[];
}

app.post('/api/fridge/recommend', (req: Request, res: Response) => {
  const body = req.body as FridgeRecommendBody;
  const have = (body.ingredients || []).map((s) => s.toLowerCase().trim()).filter(Boolean);
  const cacheKey = have.sort().join('|');

  if (recommendCache.has(cacheKey)) {
    res.json(recommendCache.get(cacheKey));
    return;
  }

  if (have.length === 0) {
    res.json([]);
    return;
  }

  const results: FridgeRecommendation[] = [];
  for (const r of recipes.values()) {
    const allIngNames = r.ingredients.map((i) => i.name.toLowerCase());
    const matched: string[] = [];
    for (const h of have) {
      for (const iname of allIngNames) {
        if (iname.includes(h) || h.includes(iname)) {
          if (!matched.includes(iname)) matched.push(iname);
          break;
        }
      }
    }
    if (matched.length > 0) {
      const score = allIngNames.length > 0 ? matched.length / allIngNames.length : 0;
      results.push({ recipe: r, matchScore: score, matchedIngredients: matched });
    }
  }

  results.sort((a, b) => b.matchScore - a.matchScore);
  recommendCache.set(cacheKey, results);
  res.json(results);
});

app.get('/api/favorites', (_req: Request, res: Response) => {
  const list = Array.from(favorites.values()).sort((a, b) => a.order - b.order);
  res.json(list);
});

app.post('/api/favorites', (req: Request, res: Response) => {
  const { recipeId } = req.body as { recipeId: string };
  if (!recipeId || !recipes.has(recipeId)) {
    return res.status(400).json({ error: '无效的食谱ID' });
  }
  if (favorites.has(recipeId)) {
    return res.json(favorites.get(recipeId));
  }
  const fav: Favorite = {
    recipeId,
    order: favorites.size,
    addedAt: Date.now(),
  };
  favorites.set(recipeId, fav);
  res.json(fav);
});

app.put('/api/favorites/order', (req: Request, res: Response) => {
  const { orders } = req.body as { orders: { recipeId: string; order: number }[] };
  for (const o of orders) {
    if (favorites.has(o.recipeId)) {
      const f = favorites.get(o.recipeId)!;
      favorites.set(o.recipeId, { ...f, order: o.order });
    }
  }
  res.json({ success: true });
});

app.delete('/api/favorites/:recipeId', (req: Request, res: Response) => {
  if (!favorites.has(req.params.recipeId)) {
    return res.status(404).json({ error: '未收藏' });
  }
  favorites.delete(req.params.recipeId);
  const remaining = Array.from(favorites.values()).sort((a, b) => a.order - b.order);
  remaining.forEach((f, idx) => {
    favorites.set(f.recipeId, { ...f, order: idx });
  });
  res.json({ success: true });
});

const generateShareCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

app.post('/api/favorites/share', (_req: Request, res: Response) => {
  const favRecipeIds = Array.from(favorites.values())
    .sort((a, b) => a.order - b.order)
    .map((f) => f.recipeId);
  
  let code: string;
  do {
    code = generateShareCode();
  } while (shareCodes.has(code));
  
  shareCodes.set(code, favRecipeIds);
  res.json({ shareCode: code });
});

app.get('/api/favorites/shared/:code', (req: Request, res: Response) => {
  const ids = shareCodes.get(req.params.code);
  if (!ids) return res.status(404).json({ error: '分享码无效或已过期' });
  const sharedRecipes: Recipe[] = [];
  for (const id of ids) {
    const r = recipes.get(id);
    if (r) sharedRecipes.push(r);
  }
  res.json(sharedRecipes);
});

app.listen(PORT, () => {
  console.log(`食谱管家服务端已启动: http://localhost:${PORT}`);
});
