import { useState, useMemo, useCallback, useEffect } from 'react';
import { Plus, Search, ChefHat } from 'lucide-react';
import RecipeCard from './components/RecipeCard';
import RecipeDetail from './components/RecipeDetail';
import RecipeForm from './components/RecipeForm';
import ConfirmDialog from './components/ConfirmDialog';
import type { Recipe, SortOption, FlavorScores } from './types';

const STORAGE_KEY = 'creative-recipes';

const createSampleRecipes = (): Recipe[] => [
  {
    id: '1',
    name: '川味麻婆豆腐',
    ingredients: ['嫩豆腐', '牛肉末', '花椒', '郫县豆瓣酱', '葱花', '蒜末'],
    cookingTime: 25,
    flavors: ['spicy', 'salty'],
    flavorScores: { sour: 2, sweet: 1, bitter: 2, spicy: 9, salty: 7 },
    rating: 5,
    createdAt: Date.now() - 86400000,
  },
  {
    id: '2',
    name: '焦糖布丁',
    ingredients: ['鸡蛋', '牛奶', '白砂糖', '香草精'],
    cookingTime: 60,
    flavors: ['sweet'],
    flavorScores: { sour: 1, sweet: 9, bitter: 2, spicy: 0, salty: 1 },
    rating: 4,
    createdAt: Date.now() - 172800000,
  },
  {
    id: '3',
    name: '柠香烤三文鱼',
    ingredients: ['三文鱼', '柠檬', '橄榄油', '黑胡椒', '海盐', '迷迭香'],
    cookingTime: 30,
    flavors: ['sour', 'salty'],
    flavorScores: { sour: 7, sweet: 2, bitter: 1, spicy: 0, salty: 6 },
    rating: 5,
    createdAt: Date.now() - 259200000,
  },
];

function App() {
  const [recipes, setRecipes] = useState<Recipe[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    return createSampleRecipes();
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | undefined>(undefined);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('rating-desc');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
    } catch {
      // ignore
    }
  }, [recipes]);

  const selectedRecipe = useMemo(
    () => recipes.find((r) => r.id === selectedId) || null,
    [recipes, selectedId]
  );

  const filteredRecipes = useMemo(() => {
    let result = [...recipes];

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(query) ||
          r.ingredients.some((i) => i.toLowerCase().includes(query))
      );
    }

    switch (sortOption) {
      case 'rating-desc':
        result.sort((a, b) => b.rating - a.rating || b.createdAt - a.createdAt);
        break;
      case 'rating-asc':
        result.sort((a, b) => a.rating - b.rating || b.createdAt - a.createdAt);
        break;
      case 'time-desc':
        result.sort((a, b) => b.cookingTime - a.cookingTime || b.createdAt - a.createdAt);
        break;
      case 'time-asc':
        result.sort((a, b) => a.cookingTime - b.cookingTime || b.createdAt - a.createdAt);
        break;
    }

    return result;
  }, [recipes, searchQuery, sortOption]);

  const handleAddRecipe = useCallback(
    (data: Omit<Recipe, 'id' | 'createdAt'>) => {
      const newRecipe: Recipe = {
        ...data,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        createdAt: Date.now(),
      };
      setRecipes((prev) => [newRecipe, ...prev]);
      setShowForm(false);
    },
    []
  );

  const handleUpdateRecipe = useCallback(
    (data: Omit<Recipe, 'id' | 'createdAt'>) => {
      if (!editingRecipe) return;
      setRecipes((prev) =>
        prev.map((r) =>
          r.id === editingRecipe.id
            ? { ...r, ...data }
            : r
        )
      );
      setEditingRecipe(undefined);
      setShowForm(false);
    },
    [editingRecipe]
  );

  const handleDeleteRecipe = useCallback((id: string) => {
    setDeleteConfirmId(id);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    setRecipes((prev) => prev.filter((r) => r.id !== deleteConfirmId));
    if (selectedId === deleteConfirmId) {
      setSelectedId(null);
    }
    setDeleteConfirmId(null);
  }, [deleteConfirmId, selectedId]);

  const handleEdit = useCallback(() => {
    if (!selectedRecipe) return;
    setEditingRecipe(selectedRecipe);
    setShowForm(true);
  }, [selectedRecipe]);

  const handleUpdateRating = useCallback(
    (rating: number) => {
      if (!selectedRecipe) return;
      setRecipes((prev) =>
        prev.map((r) => (r.id === selectedRecipe.id ? { ...r, rating } : r))
      );
    },
    [selectedRecipe]
  );

  const handleUpdateFlavorScores = useCallback(
    (flavorScores: FlavorScores) => {
      if (!selectedRecipe) return;
      setRecipes((prev) =>
        prev.map((r) => (r.id === selectedRecipe.id ? { ...r, flavorScores } : r))
      );
    },
    [selectedRecipe]
  );

  const handleOpenAddForm = useCallback(() => {
    setEditingRecipe(undefined);
    setShowForm(true);
  }, []);

  const handleCloseForm = useCallback(() => {
    setShowForm(false);
    setEditingRecipe(undefined);
  }, []);

  return (
    <>
      <nav className="navbar">
        <div className="navbar-title">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <ChefHat size={26} />
            创意食谱
          </span>
        </div>
        <div className="navbar-actions">
          {selectedId && (
            <button className="btn btn-secondary" onClick={() => setSelectedId(null)}>
              返回列表
            </button>
          )}
          <button className="btn" onClick={handleOpenAddForm}>
            <Plus size={18} />
            添加菜谱
          </button>
        </div>
      </nav>

      <main className="main-content">
        {!selectedId ? (
          <>
            <div className="toolbar">
              <div className="search-box">
                <Search size={18} />
                <input
                  type="text"
                  placeholder="搜索菜名或食材..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <select
                className="sort-select"
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
              >
                <option value="rating-desc">评分从高到低</option>
                <option value="rating-asc">评分从低到高</option>
                <option value="time-asc">烹饪时间从短到长</option>
                <option value="time-desc">烹饪时间从长到短</option>
              </select>
            </div>

            {filteredRecipes.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <ChefHat size={56} />
                </div>
                <div className="empty-state-text">
                  {searchQuery ? '没有找到匹配的菜谱' : '还没有菜谱'}
                </div>
                <div className="empty-state-hint">
                  {searchQuery ? '试试其他关键词' : '点击右上角"添加菜谱"开始记录'}
                </div>
              </div>
            ) : (
              <div className="recipe-grid">
                {filteredRecipes.map((recipe) => (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    onSelect={setSelectedId}
                    onDelete={handleDeleteRecipe}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          selectedRecipe && (
            <RecipeDetail
              recipe={selectedRecipe}
              onBack={() => setSelectedId(null)}
              onEdit={handleEdit}
              onDelete={() => handleDeleteRecipe(selectedRecipe.id)}
              onUpdateRating={handleUpdateRating}
              onUpdateFlavorScores={handleUpdateFlavorScores}
            />
          )
        )}
      </main>

      {showForm && (
        <RecipeForm
          recipe={editingRecipe}
          onSubmit={editingRecipe ? handleUpdateRecipe : handleAddRecipe}
          onClose={handleCloseForm}
        />
      )}

      {deleteConfirmId && (
        <ConfirmDialog
          message="确定要删除这个菜谱吗？此操作无法撤销。"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </>
  );
}

export default App;
