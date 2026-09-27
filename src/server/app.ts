import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { seedRecipes, seedFavorites } from './seed';

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
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value as K | undefined;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.cache.clear();
  }
}

export interface CreateAppOptions {
  recipes?: Recipe[];
  favorites?: Favorite[];
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const recipes: Map<string, Recipe> = new Map();
  const favorites: Map<string, Favorite> = new Map();
  const shareCodes: Map<string, string[]> = new Map();
  const searchCache = new LRUCache<string, Recipe[]>();
  const recommendCache = new LRUCache<string, FridgeRecommendation[]>();

  const initialRecipes = options.recipes ?? seedRecipes;
  const initialFavorites = options.favorites ?? (options.recipes ? [] : seedFavorites);
  initialRecipes.forEach((r) => recipes.set(r.id, r));
  initialFavorites.forEach((f) => favorites.set(f.recipeId, { ...f }));

  const clearAllCaches = () => {
    searchCache.clear();
    recommendCache.clear();
  };

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
        entry = { name: ing.name, category: ing.category, units: new Map() };
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
          entry = { name: item.name, category: item.category as IngredientCategory, units: new Map() };
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
    const sortedEntries = Array.from(merged.values()).sort(
      (a, b) => catOrder.indexOf(a.category) - catOrder.indexOf(b.category)
    );

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

  return app;
}
