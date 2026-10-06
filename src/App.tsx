import { Routes, Route } from 'react-router-dom';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Favorites from './pages/Favorites';
import RecipeDetail from './RecipeDetail';
import AddRecipe from './components/AddRecipe';
import Toast, { ToastType } from './components/Toast';
import { api } from './utils/api';
import { Recipe, Comment } from './types';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface AppContextValue {
  recipes: Recipe[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  showToast: (message: string, type?: ToastType) => void;
  prependRecipe: (recipe: Recipe) => void;
  toggleLike: (recipe: Recipe) => Promise<void>;
  toggleFavorite: (recipe: Recipe) => Promise<void>;
  patchIngredient: (recipeId: string, index: number, checked: boolean) => Promise<boolean>;
  patchStep: (recipeId: string, index: number, expanded: boolean) => Promise<boolean>;
  appendComment: (recipeId: string, comment: Comment) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within App');
  return ctx;
}

export default function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const likePendingRef = useRef(new Set<string>());
  const favoritePendingRef = useRef(new Set<string>());

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getRecipes()
      .then(data => {
        if (!cancelled) {
          setRecipes(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('菜谱加载失败，请检查网络后重试');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchRecipe = useCallback((id: string, updater: (r: Recipe) => Recipe) => {
    setRecipes(prev => prev.map(r => (r.id === id ? updater(r) : r)));
  }, []);

  useEffect(reload, [reload]);

  const prependRecipe = useCallback((recipe: Recipe) => {
    setRecipes(prev => (prev.some(r => r.id === recipe.id) ? prev : [recipe, ...prev]));
  }, []);

  // 乐观切换的通用实现：本地先更新 -> 请求服务端 -> 失败回滚并提示
  // pending 集合保证同一菜谱的重复点击不会发出并发请求
  const optimisticToggle = useCallback(
    async (
      recipe: Recipe,
      pendingSet: Set<string>,
      request: () => Promise<unknown>,
      onOptimistic: () => void,
      rollback: () => void,
      errorMessage: string,
    ): Promise<void> => {
      if (pendingSet.has(recipe.id)) return;
      pendingSet.add(recipe.id);
      onOptimistic();
      try {
        await request();
      } catch {
        rollback();
        showToast(errorMessage, 'error');
      } finally {
        pendingSet.delete(recipe.id);
      }
    },
    [showToast],
  );

  const toggleLike = useCallback(
    async (recipe: Recipe) => {
      const nextLiked = !recipe.liked;
      await optimisticToggle(
        recipe,
        likePendingRef.current,
        () => api.likeRecipe(recipe.id, nextLiked),
        () => {
          patchRecipe(recipe.id, r => ({
            ...r,
            liked: nextLiked,
            likes: Math.max(0, r.likes + (nextLiked ? 1 : -1)),
          }));
        },
        () => patchRecipe(recipe.id, r => ({ ...r, liked: recipe.liked, likes: recipe.likes })),
        nextLiked ? '点赞失败，请稍后重试' : '取消点赞失败，请稍后重试',
      );
    },
    [optimisticToggle, patchRecipe],
  );

  const toggleFavorite = useCallback(
    async (recipe: Recipe) => {
      const nextFavorited = !recipe.favorited;
      await optimisticToggle(
        recipe,
        favoritePendingRef.current,
        () => api.favoriteRecipe(recipe.id, nextFavorited),
        () => patchRecipe(recipe.id, r => ({ ...r, favorited: nextFavorited })),
        () => patchRecipe(recipe.id, r => ({ ...r, favorited: recipe.favorited })),
        nextFavorited ? '收藏失败，请稍后重试' : '取消收藏失败，请稍后重试',
      );
    },
    [optimisticToggle, patchRecipe],
  );

  // 食材/步骤状态：乐观更新，失败回滚（返回是否成功，供组件决定本地状态）
  const patchIngredient = useCallback(
    async (recipeId: string, index: number, checked: boolean): Promise<boolean> => {
      let success = false;
      const original = recipes.find(r => r.id === recipeId);
      const prev = original?.ingredients[index]?.checked;
      patchRecipe(recipeId, r => ({
        ...r,
        ingredients: r.ingredients.map((ing, i) => (i === index ? { ...ing, checked } : ing)),
      }));
      try {
        await api.toggleIngredient(recipeId, index, checked);
        success = true;
      } catch {
        if (prev !== undefined) {
          patchRecipe(recipeId, r => ({
            ...r,
            ingredients: r.ingredients.map((ing, i) => (i === index ? { ...ing, checked: prev } : ing)),
          }));
        }
        showToast('食材状态同步失败，请稍后重试', 'error');
      }
      return success;
    },
    [recipes, patchRecipe, showToast],
  );

  const patchStep = useCallback(
    async (recipeId: string, index: number, expanded: boolean): Promise<boolean> => {
      let success = false;
      const original = recipes.find(r => r.id === recipeId);
      const prev = original?.steps[index]?.expanded;
      patchRecipe(recipeId, r => ({
        ...r,
        steps: r.steps.map((s, i) => (i === index ? { ...s, expanded } : s)),
      }));
      try {
        await api.toggleStep(recipeId, index, expanded);
        success = true;
      } catch {
        if (prev !== undefined) {
          patchRecipe(recipeId, r => ({
            ...r,
            steps: r.steps.map((s, i) => (i === index ? { ...s, expanded: prev } : s)),
          }));
        }
        showToast('步骤状态同步失败，请稍后重试', 'error');
      }
      return success;
    },
    [recipes, patchRecipe, showToast],
  );

  const appendComment = useCallback((recipeId: string, comment: Comment) => {
    patchRecipe(recipeId, r => ({ ...r, comments: [...r.comments, comment] }));
  }, [patchRecipe]);

  const contextValue: AppContextValue = {
    recipes,
    loading,
    error,
    reload,
    showToast,
    prependRecipe,
    toggleLike,
    toggleFavorite,
    patchIngredient,
    patchStep,
    appendComment,
  };

  return (
    <AppContext.Provider value={contextValue}>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/recipe/:id" element={<RecipeDetail />} />
        <Route path="/add-recipe" element={<AddRecipe />} />
      </Routes>
      <Toast toasts={toasts} />
    </AppContext.Provider>
  );
}
