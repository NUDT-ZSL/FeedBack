import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import {
  Search, Plus, X, ChefHat, Clock, Flame, Trash2,
  GripVertical, Share2, Copy, Check, ArrowUpFromLine, Eye,
} from 'lucide-react';
import {
  Recipe, Ingredient, CookingStep, Favorite, FridgeRecommendation,
  TabKey, IngredientCategory, CATEGORY_LABELS, CUISINE_OPTIONS, UNIT_OPTIONS, DIFFICULTY_LABELS,
} from './types';
import RecipeCard from './RecipeCard';
import ShoppingList from './ShoppingList';

const TAB_LABELS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'recipes', label: '食谱', icon: <ChefHat size={18} /> },
  { key: 'shopping', label: '购物清单', icon: <Search size={18} style={{ transform: 'rotate(0deg)' }} /> },
  { key: 'fridge', label: '扫冰箱', icon: <Eye size={18} /> },
  { key: 'favorites', label: '收藏夹', icon: <span style={{ fontSize: 18 }}>❤️</span> },
];

const NAV_ICON_OVERRIDE: Record<TabKey, React.ReactNode> = {
  recipes: <ChefHat size={20} />,
  shopping: <span style={{ fontSize: 20 }}>🛒</span>,
  fridge: <span style={{ fontSize: 20 }}>🧊</span>,
  favorites: <span style={{ fontSize: 20 }}>❤️</span>,
};

const CATEGORY_SELECT_OPTIONS: { value: IngredientCategory; label: string }[] = [
  { value: 'vegetable', label: '🥬 蔬菜' },
  { value: 'meat', label: '🥩 肉类' },
  { value: 'grain', label: '🍚 谷薯豆类' },
  { value: 'dairy', label: '🥛 蛋奶乳品' },
  { value: 'seasoning', label: '🧂 调味品' },
  { value: 'other', label: '📦 其他食材' },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('recipes');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [detailRecipe, setDetailRecipe] = useState<Recipe | null>(null);
  const [selectedIngredientsForShopping, setSelectedIngredientsForShopping] = useState<string[]>([]);

  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const [shareCode, setShareCode] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    const loadAll = async () => {
      try {
        const url = debouncedSearch
          ? `/api/recipes/search?q=${encodeURIComponent(debouncedSearch)}`
          : '/api/recipes';
        const [rRes, fRes] = await Promise.all([fetch(url), fetch('/api/favorites')]);
        if (!rRes.ok) throw new Error('加载食谱失败');
        if (!fRes.ok) throw new Error('加载收藏失败');
        const rData: Recipe[] = await rRes.json();
        const fData: Favorite[] = await fRes.json();
        setRecipes(rData);
        setFavoriteIds(fData.sort((a, b) => a.order - b.order).map((f) => f.recipeId));
      } catch (err) {
        console.error('加载数据失败:', err);
      }
    };
    loadAll();
  }, [debouncedSearch]);

  const refreshRecipes = useCallback(async () => {
    try {
      const url = debouncedSearch
        ? `/api/recipes/search?q=${encodeURIComponent(debouncedSearch)}`
        : '/api/recipes';
      const res = await fetch(url);
      if (!res.ok) throw new Error('加载食谱失败');
      const data: Recipe[] = await res.json();
      setRecipes(data);
    } catch (err) {
      console.error('加载食谱失败:', err);
      alert('加载食谱失败，请刷新页面重试');
    }
  }, [debouncedSearch]);

  const refreshFavorites = useCallback(async () => {
    try {
      const res = await fetch('/api/favorites');
      if (!res.ok) throw new Error('加载收藏失败');
      const data: Favorite[] = await res.json();
      setFavoriteIds(data.sort((a, b) => a.order - b.order).map((f) => f.recipeId));
    } catch (err) {
      console.error('加载收藏失败:', err);
    }
  }, []);

  const toggleFavorite = useCallback(async (recipeId: string) => {
    try {
      if (favoriteIds.includes(recipeId)) {
        const res = await fetch(`/api/favorites/${recipeId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('取消收藏失败');
        setFavoriteIds((prev) => prev.filter((id) => id !== recipeId));
      } else {
        const res = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipeId }),
        });
        if (!res.ok) throw new Error('收藏失败');
        setFavoriteIds((prev) => [...prev, recipeId]);
      }
    } catch (err) {
      console.error('收藏操作失败:', err);
      alert('操作失败，请重试');
    }
  }, [favoriteIds]);

  const handleCreateRecipe = () => {
    setEditingRecipe(null);
    setIsFormOpen(true);
  };

  const handleEditRecipe = (recipe: Recipe) => {
    setEditingRecipe(recipe);
    setIsFormOpen(true);
  };

  const handleDeleteRecipe = async (recipeId: string) => {
    if (!confirm('确定删除这道食谱吗？此操作不可撤销。')) return;
    try {
      const res = await fetch(`/api/recipes/${recipeId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');
      setRecipes((prev) => prev.filter((r) => r.id !== recipeId));
      setFavoriteIds((prev) => prev.filter((id) => id !== recipeId));
    } catch (err) {
      console.error('删除食谱失败:', err);
      alert('删除失败，请重试');
    }
  };

  const handleSaveRecipe = async (data: Omit<Recipe, 'id' | 'createdAt'> & { id?: string }) => {
    try {
      if (data.id) {
        const res = await fetch(`/api/recipes/${data.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('更新食谱失败');
        await res.json();
      } else {
        const res = await fetch('/api/recipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('创建食谱失败');
        await res.json();
      }
      setIsFormOpen(false);
      setEditingRecipe(null);
      await refreshRecipes();
    } catch (err) {
      console.error('保存食谱失败:', err);
      alert('保存失败，请重试');
    }
  };

  const handleAddRecipeToShopping = (recipe: Recipe) => {
    setDetailRecipe(recipe);
    setSelectedIngredientsForShopping(recipe.ingredients.map((i) => i.name));
  };

  const handleSubmitIngredientsToShopping = async () => {
    if (!detailRecipe) return;
    try {
      const res = await fetch('/api/shopping/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedIngredients: [{
            recipeId: detailRecipe.id,
            ingredientNames: selectedIngredientsForShopping,
          }],
        }),
      });
      if (!res.ok) throw new Error('添加购物清单失败');
      setDetailRecipe(null);
      setSelectedIngredientsForShopping([]);
      setActiveTab('shopping');
    } catch (err) {
      console.error('添加购物清单失败:', err);
      alert('添加失败，请重试');
    }
  };

  const toggleIngredientForShopping = (name: string) => {
    setSelectedIngredientsForShopping((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const renderRecipesPage = () => (
    <div>
      <h1 className="page-title">🍽️ 食谱收藏夹</h1>
      <p className="page-subtitle">共 {recipes.length} 道美味食谱，点击卡片查看详细做法。</p>

      <div className="search-bar">
        <div className="search-input-wrap">
          <Search size={18} />
          <input
            className="search-input"
            placeholder="搜索菜名或食材..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={handleCreateRecipe}>
          <Plus size={18} /> 新建食谱
        </button>
      </div>

      {recipes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🍳</div>
          <h3>{debouncedSearch ? '未找到匹配的食谱' : '还没有食谱'}</h3>
          <p>{debouncedSearch ? '试试其他关键词吧' : '点击右上角按钮创建你的第一道食谱！'}</p>
        </div>
      ) : (
        <div className="recipe-grid">
          {recipes.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              isFavorite={favoriteIds.includes(r.id)}
              onToggleFavorite={toggleFavorite}
              onEdit={handleEditRecipe}
              onDelete={handleDeleteRecipe}
              onViewDetail={(recipe) => {
                setDetailRecipe(recipe);
                setSelectedIngredientsForShopping([]);
              }}
              onAddToShopping={handleAddRecipeToShopping}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo">
          <span className="app-logo-icon">🍲</span>
          <span>家庭食谱管家</span>
        </div>
        <nav className="desktop-nav">
          {TAB_LABELS.map((t) => (
            <button
              key={t.key}
              className={`nav-btn ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {NAV_ICON_OVERRIDE[t.key]}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {activeTab === 'recipes' && (
        <div className="mobile-search-container">
          <div className="search-input-wrap">
            <Search size={18} />
            <input
              className="search-input"
              placeholder="搜索菜名或食材..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      <main className="page-content">
        {activeTab === 'recipes' && renderRecipesPage()}
        {activeTab === 'shopping' && (
          <ShoppingList
            recipes={recipes}
            onViewRecipeDetail={(recipe) => {
              setDetailRecipe(recipe);
              setSelectedIngredientsForShopping([]);
            }}
          />
        )}
        {activeTab === 'fridge' && (
          <FridgeScanPage
            recipes={recipes}
            onViewRecipeDetail={(recipe) => {
              setDetailRecipe(recipe);
              setSelectedIngredientsForShopping([]);
            }}
            onAddRecipeToShopping={handleAddRecipeToShopping}
          />
        )}
        {activeTab === 'favorites' && (
          <FavoritesPage
            recipes={recipes}
            favoriteIds={favoriteIds}
            toggleFavorite={toggleFavorite}
            refreshFavorites={refreshFavorites}
            onViewRecipeDetail={(recipe) => {
              setDetailRecipe(recipe);
              setSelectedIngredientsForShopping([]);
            }}
            onShare={() => setShareCode(null)}
            shareCode={shareCode}
            setShareCode={setShareCode}
            copySuccess={copySuccess}
            setCopySuccess={setCopySuccess}
          />
        )}
      </main>

      <nav className="mobile-nav">
        {TAB_LABELS.map((t) => (
          <button
            key={t.key}
            className={`nav-btn ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {NAV_ICON_OVERRIDE[t.key]}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {isFormOpen && (
        <RecipeFormModal
          initialData={editingRecipe}
          onClose={() => { setIsFormOpen(false); setEditingRecipe(null); }}
          onSave={handleSaveRecipe}
        />
      )}

      {detailRecipe && (
        <RecipeDetailModal
          recipe={detailRecipe}
          isInShoppingMode={selectedIngredientsForShopping.length > 0 || activeTab === 'recipes' && false}
          showShoppingPicker={activeTab === 'recipes' ? true : false}
          selectedIngredients={selectedIngredientsForShopping}
          onToggleIngredient={toggleIngredientForShopping}
          onSubmitShopping={handleSubmitIngredientsToShopping}
          onClose={() => {
            setDetailRecipe(null);
            setSelectedIngredientsForShopping([]);
          }}
          onEdit={handleEditRecipe}
          onToggleFavorite={toggleFavorite}
          isFavorite={favoriteIds.includes(detailRecipe.id)}
        />
      )}
    </div>
  );
};

/* ===== 扫冰箱页面 ===== */
interface FridgeScanPageProps {
  recipes: Recipe[];
  onViewRecipeDetail: (recipe: Recipe) => void;
  onAddRecipeToShopping: (recipe: Recipe) => void;
}

const FridgeScanPage: React.FC<FridgeScanPageProps> = ({ onViewRecipeDetail, onAddRecipeToShopping }) => {
  const [tags, setTags] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [recommendations, setRecommendations] = useState<FridgeRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const QUICK_TAGS = ['番茄', '鸡蛋', '土豆', '猪肉', '鸡肉', '豆腐', '青椒', '胡萝卜', '西兰花', '洋葱'];

  const addTag = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (tags.some((t) => t.toLowerCase() === v.toLowerCase())) return;
    setTags((prev) => [...prev, v]);
    setInputValue('');
  };

  const removeTag = (idx: number) => {
    setTags((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === '，' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const runRecommend = useCallback(async () => {
    if (tags.length === 0) {
      setRecommendations([]);
      return;
    }
    setLoading(true);
    try {
      const start = performance.now();
      const res = await fetch('/api/fridge/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: tags }),
      });
      if (!res.ok) throw new Error('获取推荐失败');
      const data: FridgeRecommendation[] = await res.json();
      console.log(`推荐耗时: ${(performance.now() - start).toFixed(1)}ms`);
      setRecommendations(data);
    } catch (err) {
      console.error('获取推荐失败:', err);
      alert('获取推荐失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [tags]);

  useEffect(() => {
    const t = setTimeout(runRecommend, 120);
    return () => clearTimeout(t);
  }, [runRecommend]);

  const pickEmoji = (r: Recipe) => {
    const map: Record<string, string> = {
      '番茄': '🍅', '鸡蛋': '🥚', '肉': '🥩', '鸡': '🍗', '豆腐': '🧈',
      '土豆': '🥔', '胡萝卜': '🥕', '西兰花': '🥦', '黄瓜': '🥒',
    };
    for (const ing of r.ingredients) {
      for (const [k, v] of Object.entries(map)) {
        if (ing.name.includes(k)) return v;
      }
    }
    return '🍽️';
  };

  return (
    <div>
      <h1 className="page-title">🧊 扫冰箱</h1>
      <p className="page-subtitle">
        输入冰箱里剩余的食材，AI 会为你推荐可以做的菜谱（匹配度越高越靠前）。
      </p>

      <section className="fridge-section">
        <div
          className="tag-input-container"
          onClick={() => inputRef.current?.focus()}
        >
          {tags.map((t, i) => (
            <span key={i} className="tag-item">
              {t}
              <button
                className="tag-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(i);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            className="tag-input"
            placeholder={tags.length === 0 ? '输入食材，按回车添加...' : ''}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => inputValue.trim() && addTag(inputValue)}
          />
        </div>
        <p className="tag-hint">💡 提示：输入后按回车或逗号确认；退格键可删除最后一个标签</p>

        <div className="quick-tags">
          {QUICK_TAGS.map((t) => (
            <button
              key={t}
              className="quick-tag"
              onClick={() => addTag(t)}
              disabled={tags.includes(t)}
              style={{ opacity: tags.includes(t) ? 0.4 : 1, cursor: tags.includes(t) ? 'not-allowed' : 'pointer' }}
            >
              + {t}
            </button>
          ))}
        </div>
      </section>

      <section>
        {loading ? (
          <div className="empty-state"><div className="empty-state-icon">⏳</div><p>正在匹配食谱...</p></div>
        ) : tags.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🧊</div>
            <h3>先来添加你有的食材吧</h3>
            <p>例如：鸡蛋、番茄、猪肉，输入后按回车确认</p>
          </div>
        ) : recommendations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🤔</div>
            <h3>暂未找到合适的食谱</h3>
            <p>试试添加更多常见食材，或者减少输入量</p>
          </div>
        ) : (
          <div className="recommend-list">
            {[...recommendations]
              .sort((a, b) => b.matchScore - a.matchScore)
              .map((rec, idx) => {
                const opacity = 0.35 + 0.65 * rec.matchScore;
                return (
                  <div
                    key={rec.recipe.id}
                    className="recommend-card"
                    style={{ opacity: Math.max(0.35, opacity) }}
                  >
                  <div className="recommend-emoji">{pickEmoji(rec.recipe)}</div>
                  <div className="recommend-info">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {rec.recipe.name}
                      <span style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text-light)',
                        background: 'var(--color-warm-white)',
                        padding: '2px 10px',
                        borderRadius: 100,
                      }}>
                        #{idx + 1} 推荐
                      </span>
                    </h3>
                    <div className="match-bar-wrap">
                      <div className="match-bar">
                        <div
                          className="match-bar-fill"
                          style={{ width: `${(rec.matchScore * 100).toFixed(0)}%` }}
                        />
                      </div>
                      <span className="match-score">{(rec.matchScore * 100).toFixed(0)}%</span>
                    </div>
                    <div className="matched-tags">
                      {rec.matchedIngredients.map((ing, i) => (
                        <span key={i} className="matched-tag">✓ {ing}</span>
                      ))}
                    </div>
                  </div>
                  <div className="recommend-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => onViewRecipeDetail(rec.recipe)}>
                      <Eye size={14} /> 详情
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => onAddRecipeToShopping(rec.recipe)}>
                      <ArrowUpFromLine size={14} /> 加入计划
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

/* ===== 收藏夹页面 ===== */
interface FavoritesPageProps {
  recipes: Recipe[];
  favoriteIds: string[];
  toggleFavorite: (id: string) => void;
  refreshFavorites: () => void;
  onViewRecipeDetail: (recipe: Recipe) => void;
  onShare: () => void;
  shareCode: string | null;
  setShareCode: (c: string | null) => void;
  copySuccess: boolean;
  setCopySuccess: (b: boolean) => void;
}

const FavoritesPage: React.FC<FavoritesPageProps> = ({
  recipes, favoriteIds, toggleFavorite, refreshFavorites, onViewRecipeDetail,
  shareCode, setShareCode, copySuccess, setCopySuccess,
}) => {
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [sharingRecipe, setSharingRecipe] = useState<Recipe | null>(null);
  const [shareType, setShareType] = useState<'single' | 'all'>('all');

  const favoriteRecipes = useMemo(
    () => favoriteIds.map((id) => recipes.find((r) => r.id === id)).filter(Boolean) as Recipe[],
    [favoriteIds, recipes]
  );

  const handleGenerateShareCode = async (recipe?: Recipe) => {
    try {
      const body = recipe ? { recipeId: recipe.id } : {};
      const res = await fetch('/api/favorites/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('获取分享码失败');
      const data = await res.json();
      setShareCode(data.shareCode);
      setShareType(recipe ? 'single' : 'all');
      if (recipe) setSharingRecipe(recipe);
      setShareModalOpen(true);
    } catch (err) {
      console.error('获取分享码失败:', err);
      alert('获取分享码失败，请重试');
    }
  };

  const handleCopy = async () => {
    if (!shareCode) return;
    try {
      await navigator.clipboard.writeText(shareCode);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      const el = document.createElement('input');
      el.value = shareCode;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const pickEmoji = (r: Recipe) => {
    const map: Record<string, string> = {
      '番茄': '🍅', '鸡蛋': '🥚', '肉': '🥩', '鸡': '🍗', '豆腐': '🧈',
      '土豆': '🥔', '胡萝卜': '🥕', '西兰花': '🥦',
    };
    for (const ing of r.ingredients) {
      for (const [k, v] of Object.entries(map)) {
        if (ing.name.includes(k)) return v;
      }
    }
    return '🍽️';
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const { source, destination } = result;
    if (source.index === destination.index) return;

    const newOrder = [...favoriteIds];
    const [removed] = newOrder.splice(source.index, 1);
    newOrder.splice(destination.index, 0, removed);

    try {
      const orders = newOrder.map((recipeId, order) => ({ recipeId, order }));
      const res = await fetch('/api/favorites/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (!res.ok) throw new Error('保存顺序失败');
    } catch (err) {
      console.error('保存顺序失败:', err);
      refreshFavorites();
    }
  };

  return (
    <div>
      <div className="favorites-header">
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>❤️ 我的收藏夹</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            共 {favoriteRecipes.length} 道收藏 · 拖拽卡片调整顺序
          </p>
        </div>
        <button
          className="btn btn-primary"
          disabled={favoriteRecipes.length === 0}
          onClick={() => handleGenerateShareCode()}
        >
          <Share2 size={18} /> 分享收藏夹
        </button>
      </div>

      {favoriteRecipes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💝</div>
          <h3>收藏夹还是空的</h3>
          <p>在食谱页面点击❤️按钮，把喜欢的菜谱加入收藏吧！</p>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="favorites" direction="vertical">
            {(provided, snapshot) => (
              <div
              {...provided.droppableProps}
              ref={provided.innerRef}
              className="favorites-waterfall"
            >
              {favoriteRecipes.map((r, index) => (
                <Draggable key={r.id} draggableId={r.id} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      style={{
                        ...provided.draggableProps.style,
                        opacity: snapshot.isDragging ? 0.8 : 1,
                        transform: snapshot.isDragging
                          ? `${provided.draggableProps.style?.transform}`
                          : provided.draggableProps.style?.transform,
                      }}
                      className={`favorite-card ${snapshot.isDragging ? 'dragging' : ''}`}
                      onClick={() => onViewRecipeDetail(r)}
                    >
                      <div className="favorite-card-cover">
                        <div
                          className="favorite-card-handle"
                          {...provided.dragHandleProps}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <GripVertical size={14} />
                        </div>
                        <span style={{ fontSize: 56 }}>{pickEmoji(r)}</span>
                        <button
                          className="action-icon-btn"
                          style={{ position: 'absolute', top: 10, right: 10, opacity: 1 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(r.id);
                          }}
                          title="取消收藏"
                        >
                          <Trash2 size={14} />
                        </button>
                        <button
                          className="action-icon-btn"
                          style={{
                            position: 'absolute',
                            bottom: 10,
                            right: 10,
                            opacity: 1,
                            background: 'rgba(255,255,255,0.95)',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGenerateShareCode(r);
                          }}
                          title="分享"
                        >
                          <Share2 size={14} />
                        </button>
                      </div>
                      <div className="favorite-card-body">
                        <h3>{r.name}</h3>
                        <p>{r.cuisine} · {r.ingredients.length}种食材 · #{index + 1}</p>
                        <div className="favorite-card-meta">
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-light)' }}>
                            <Clock size={12} /> {r.cookTime}分钟
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-light)' }}>
                            <Flame size={12} /> {DIFFICULTY_LABELS[r.difficulty]}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
          </Droppable>
        </DragDropContext>
      )}

      {shareModalOpen && (
        <div className="modal-overlay" onClick={() => { setShareModalOpen(false); setSharingRecipe(null); }}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2 className="modal-title">
                <Share2 size={20} style={{ display: 'inline', marginRight: 6 }} />
                {shareType === 'single' ? `分享「${sharingRecipe?.name}」` : '分享收藏夹'}
              </h2>
              <button className="action-icon-btn" onClick={() => { setShareModalOpen(false); setSharingRecipe(null); }}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="share-modal">
                <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 8 }}>
                  将下方 6 位分享码发给家人，对方在首页/收藏夹输入后
                  <br />即可浏览{shareType === 'single' ? '该食谱' : '全部食谱'}（查看权限，不可编辑）
                </p>
                <div className="share-code-display">{shareCode}</div>
                <button className="btn btn-primary" onClick={handleCopy}>
                  {copySuccess ? <><Check size={16} /> 已复制</> : <><Copy size={16} /> 复制分享码</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ===== 食谱详情模态框 ===== */
interface RecipeDetailModalProps {
  recipe: Recipe;
  isInShoppingMode: boolean;
  showShoppingPicker: boolean;
  selectedIngredients: string[];
  onToggleIngredient: (name: string) => void;
  onSubmitShopping: () => void;
  onClose: () => void;
  onEdit: (recipe: Recipe) => void;
  onToggleFavorite: (id: string) => void;
  isFavorite: boolean;
}

const RecipeDetailModal: React.FC<RecipeDetailModalProps> = ({
  recipe, selectedIngredients, onToggleIngredient, onSubmitShopping,
  onClose, onEdit, onToggleFavorite, isFavorite, showShoppingPicker,
}) => {
  const allSelected = recipe.ingredients.length > 0 && recipe.ingredients.every((i) => selectedIngredients.includes(i.name));
  const toggleAll = () => {
    if (allSelected) {
      recipe.ingredients.forEach((i) => {
        if (selectedIngredients.includes(i.name)) onToggleIngredient(i.name);
      });
    } else {
      recipe.ingredients.forEach((i) => {
        if (!selectedIngredients.includes(i.name)) onToggleIngredient(i.name);
      });
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{recipe.name}</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="action-icon-btn" onClick={() => onToggleFavorite(recipe.id)} style={{ color: isFavorite ? 'var(--color-warm-orange)' : undefined }}>
              <span style={{ fontSize: 16 }}>{isFavorite ? '❤️' : '🤍'}</span>
            </button>
            <button className="action-icon-btn" onClick={() => { onEdit(recipe); onClose(); }}>
              <span style={{ fontSize: 16 }}>✏️</span>
            </button>
            <button className="action-icon-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="modal-body">
          <div className="recipe-detail-meta">
            <span className="meta-item"><ChefHat size={16} /><strong>菜系：</strong>{recipe.cuisine}</span>
            <span className="meta-item"><Clock size={16} /><strong>时长：</strong>{recipe.cookTime} 分钟</span>
            <span className="meta-item"><Flame size={16} /><strong>难度：</strong>{DIFFICULTY_LABELS[recipe.difficulty]}</span>
            <span className="meta-item">🍴 <strong>食材：</strong>{recipe.ingredients.length} 种</span>
          </div>

          {showShoppingPicker && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              padding: '10px 14px',
              background: 'var(--color-warm-orange-light)',
              borderRadius: 8,
            }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-warm-orange-dark)' }}>
                🛒 勾选食材加入购物清单（{selectedIngredients.length}/{recipe.ingredients.length}）
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={toggleAll}
                style={{ color: 'var(--color-warm-orange-dark)' }}
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>
          )}

          <h3 className="section-title">🥬 主料食材</h3>
          <div className="ingredients-list">
            {recipe.ingredients.map((ing) => (
              <label key={ing.name} className="ingredient-item" style={{ cursor: showShoppingPicker ? 'pointer' : 'default' }}>
                {showShoppingPicker ? (
                  <input
                    type="checkbox"
                    className="ingredient-checkbox"
                    checked={selectedIngredients.includes(ing.name)}
                    onChange={() => onToggleIngredient(ing.name)}
                  />
                ) : (
                  <div
                    className="category-color"
                    style={{
                      background: `var(--color-${ing.category === 'seasoning' ? 'seasoning' : ing.category === 'meat' ? 'meat' : 'vegetable'})`,
                      width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                    }}
                  />
                )}
                <div className="ingredient-info">
                  <strong>{ing.name}</strong>
                  <span>{ing.amount} {ing.unit} <small style={{ opacity: 0.7 }}>· {CATEGORY_LABELS[ing.category]}</small></span>
                </div>
              </label>
            ))}
          </div>

          {recipe.seasonings.length > 0 && (
            <>
              <h3 className="section-title">🧂 调味佐料</h3>
              <div className="ingredients-list">
                {recipe.seasonings.map((ing) => (
                  <div key={ing.name} className="ingredient-item">
                    <div className="ingredient-info">
                      <strong>{ing.name}</strong>
                      <span>{ing.amount} {ing.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <h3 className="section-title">📝 烹饪步骤</h3>
          <ol className="steps-list">
            {recipe.steps.map((s) => (
              <li key={s.order} className="step-item">
                <p>{s.description}</p>
              </li>
            ))}
          </ol>
        </div>
        {showShoppingPicker && (
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>关闭</button>
            <button
              className="btn btn-primary"
              disabled={selectedIngredients.length === 0}
              onClick={onSubmitShopping}
            >
              加入购物清单 ({selectedIngredients.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ===== 食谱表单模态框 ===== */
interface RecipeFormModalProps {
  initialData: Recipe | null;
  onClose: () => void;
  onSave: (data: Omit<Recipe, 'id' | 'createdAt'> & { id?: string }) => void;
}

const RecipeFormModal: React.FC<RecipeFormModalProps> = ({ initialData, onClose, onSave }) => {
  const [name, setName] = useState(initialData?.name || '');
  const [cuisine, setCuisine] = useState(initialData?.cuisine || '家常菜');
  const [cookTime, setCookTime] = useState(String(initialData?.cookTime ?? 15));
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>(initialData?.difficulty || 'easy');
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    initialData?.ingredients.length ? initialData.ingredients : [
      { name: '', amount: 0, unit: '克', category: 'vegetable' as IngredientCategory },
    ]
  );
  const [seasonings, setSeasonings] = useState<Ingredient[]>(
    initialData?.seasonings || [{ name: '', amount: 0, unit: '克', category: 'seasoning' as IngredientCategory }]
  );
  const [steps, setSteps] = useState<CookingStep[]>(
    initialData?.steps.length ? initialData.steps : [{ order: 1, description: '' }]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateIngredient = (idx: number, key: keyof Ingredient, value: string | number) => {
    setIngredients((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  };

  const addIngredient = () => {
    setIngredients((prev) => [...prev, { name: '', amount: 0, unit: '克', category: 'vegetable' }]);
  };

  const removeIngredient = (idx: number) => {
    setIngredients((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const updateSeasoning = (idx: number, key: keyof Ingredient, value: string | number) => {
    setSeasonings((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  };

  const addSeasoning = () => {
    setSeasonings((prev) => [...prev, { name: '', amount: 0, unit: '克', category: 'seasoning' }]);
  };

  const removeSeasoning = (idx: number) => {
    setSeasonings((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const updateStep = (idx: number, value: string) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, description: value } : s)));
  };

  const addStep = () => {
    setSteps((prev) => [...prev, { order: prev.length + 1, description: '' }]);
  };

  const removeStep = (idx: number) => {
    if (steps.length <= 1) return;
    const filtered = steps.filter((_, i) => i !== idx);
    setSteps(filtered.map((s, i) => ({ ...s, order: i + 1 })));
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= steps.length) return;
    setSteps((prev) => {
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr.map((s, i) => ({ ...s, order: i + 1 }));
    });
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = '请输入菜名';
    const validIngredients = ingredients.filter((i) => i.name.trim());
    if (validIngredients.length === 0) newErrors.ingredients = '至少添加一个食材';
    const validSteps = steps.filter((s) => s.description.trim());
    if (validSteps.length === 0) newErrors.steps = '至少填写一个烹饪步骤';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    onSave({
      id: initialData?.id,
      name: name.trim(),
      cuisine,
      cookTime: parseInt(cookTime, 10) || 15,
      difficulty,
      ingredients: validIngredients.map((i) => ({
        ...i,
        name: i.name.trim(),
        amount: parseFloat(String(i.amount)) || 1,
      })),
      seasonings: seasonings.filter((s) => s.name.trim()).map((s) => ({
        ...s,
        name: s.name.trim(),
        amount: parseFloat(String(s.amount)) || 1,
      })),
      steps: validSteps.map((s, i) => ({ order: i + 1, description: s.description.trim() })),
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{initialData ? '✏️ 编辑食谱' : '➕ 新建食谱'}</h2>
          <button className="action-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">菜名 *</label>
              <input
                className="form-input"
                placeholder="例如：番茄炒蛋"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ borderColor: errors.name ? '#EF4444' : undefined }}
              />
              {errors.name && <p style={{ color: '#EF4444', fontSize: 12, marginTop: 4 }}>{errors.name}</p>}
            </div>
            <div className="form-group">
              <label className="form-label">菜系分类</label>
              <select className="form-select" value={cuisine} onChange={(e) => setCuisine(e.target.value)}>
                {CUISINE_OPTIONS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">烹饪时长（分钟）</label>
              <input
                type="number"
                min="1"
                className="form-input"
                value={cookTime}
                onChange={(e) => setCookTime(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">难度等级</label>
              <select
                className="form-select"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
              >
                <option value="easy">简单</option>
                <option value="medium">中等</option>
                <option value="hard">困难</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              食材列表（名称 + 数量 + 单位 + 分类）*
            </label>
            {errors.ingredients && <p style={{ color: '#EF4444', fontSize: 12, marginBottom: 6 }}>{errors.ingredients}</p>}
            {ingredients.map((ing, idx) => (
              <div key={idx} className="ingredient-row">
                <input
                  className="form-input"
                  placeholder="食材名称"
                  value={ing.name}
                  onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                />
                <input
                  className="form-input"
                  placeholder="数量"
                  type="number"
                  min="0"
                  step="0.1"
                  value={ing.amount || ''}
                  onChange={(e) => updateIngredient(idx, 'amount', e.target.value)}
                />
                <select
                  className="form-select"
                  value={ing.unit}
                  onChange={(e) => updateIngredient(idx, 'unit', e.target.value)}
                >
                  {UNIT_OPTIONS.map((u) => <option key={u}>{u}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 4 }}>
                  <select
                    className="form-select"
                    value={ing.category}
                    onChange={(e) => updateIngredient(idx, 'category', e.target.value as IngredientCategory)}
                    style={{ gridColumn: 'span 2' }}
                  >
                    {CATEGORY_SELECT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button className="remove-btn" onClick={() => removeIngredient(idx)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <button className="add-item-btn" onClick={addIngredient}>
              <Plus size={14} /> 添加食材
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">佐料用量</label>
            {seasonings.map((s, idx) => (
              <div key={idx} className="ingredient-row">
                <input
                  className="form-input"
                  placeholder="佐料名称"
                  value={s.name}
                  onChange={(e) => updateSeasoning(idx, 'name', e.target.value)}
                />
                <input
                  className="form-input"
                  placeholder="数量"
                  type="number"
                  min="0"
                  step="0.1"
                  value={s.amount || ''}
                  onChange={(e) => updateSeasoning(idx, 'amount', e.target.value)}
                />
                <select
                  className="form-select"
                  value={s.unit}
                  onChange={(e) => updateSeasoning(idx, 'unit', e.target.value)}
                >
                  {UNIT_OPTIONS.map((u) => <option key={u}>{u}</option>)}
                </select>
                <button className="remove-btn" onClick={() => removeSeasoning(idx)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button className="add-item-btn" onClick={addSeasoning}>
              <Plus size={14} /> 添加佐料
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">烹饪步骤（支持排序） *</label>
            {errors.steps && <p style={{ color: '#EF4444', fontSize: 12, marginBottom: 6 }}>{errors.steps}</p>}
            {steps.map((s, idx) => (
              <div key={idx} className="step-row">
                <div className="step-order">{idx + 1}</div>
                <textarea
                  className="form-textarea"
                  placeholder={`步骤 ${idx + 1} 的操作描述...`}
                  value={s.description}
                  onChange={(e) => updateStep(idx, e.target.value)}
                  style={{ minHeight: 56 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => moveStep(idx, -1)}
                      disabled={idx === 0}
                      style={{ padding: 6 }}
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => moveStep(idx, 1)}
                      disabled={idx === steps.length - 1}
                      style={{ padding: 6 }}
                    >
                      ↓
                    </button>
                  </div>
                  <button className="remove-btn" onClick={() => removeStep(idx)} style={{ alignSelf: 'center' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <button className="add-item-btn" onClick={addStep}>
              <Plus size={14} /> 添加步骤
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            {initialData ? '保存修改' : '创建食谱'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
