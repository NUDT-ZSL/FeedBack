import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App';
import { api } from '../utils/api';
import SearchBar from '../components/SearchBar';
import CategoryFilter from '../components/CategoryFilter';
import RecipeList from '../components/RecipeList';

const FALLBACK_CATEGORIES = ['中餐', '西餐', '日料', '韩餐', '甜点', '饮品', '素食'];

export default function Home() {
  const { recipes, loading, error, reload } = useApp();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES);

  useEffect(() => {
    api
      .getCategories()
      .then(setCategories)
      .catch(() => setCategories(FALLBACK_CATEGORIES));
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return recipes.filter(recipe => {
      const matchCategory = category === '全部' || recipe.category === category;
      if (!matchCategory) return false;
      if (!keyword) return true;
      const inTitle = recipe.title.toLowerCase().includes(keyword);
      const inTags = recipe.tags.some(tag => tag.toLowerCase().includes(keyword));
      const inIngredients = recipe.ingredients.some(ing => ing.name.toLowerCase().includes(keyword));
      return inTitle || inTags || inIngredients;
    });
  }, [recipes, search, category]);

  if (loading) {
    return (
      <div className="page-status">
        <div className="loading-spinner" />
        <p>正在加载美味菜谱…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-status">
        <div className="empty-illustration">🍳</div>
        <p>{error}</p>
        <button className="primary-btn" onClick={reload}>
          重新加载
        </button>
      </div>
    );
  }

  return (
    <main className="container home-page">
      <header className="home-header">
        <h1>发现美味灵感</h1>
        <p>搜索、筛选社区分享的 {recipes.length} 道菜谱</p>
      </header>
      <SearchBar value={search} onChange={setSearch} />
      <CategoryFilter categories={categories} active={category} onChange={setCategory} />
      {filtered.length > 0 ? (
        <RecipeList recipes={filtered} />
      ) : (
        <div className="page-status empty-result">
          <div className="empty-illustration">🥘</div>
          <p>没有找到相关菜谱，换个关键词试试吧</p>
        </div>
      )}
    </main>
  );
}
