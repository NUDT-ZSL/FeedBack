import { Link } from 'react-router-dom';
import { useApp } from '../App';
import RecipeList from '../components/RecipeList';

export default function Favorites() {
  const { recipes, loading, error, reload } = useApp();
  const favorites = recipes.filter(r => r.favorited);

  if (loading) {
    return (
      <div className="page-status">
        <div className="loading-spinner" />
        <p>正在加载收藏夹…</p>
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
    <main className="container favorites-page">
      <header className="home-header">
        <h1>我的收藏</h1>
        <p>{favorites.length > 0 ? `共收藏了 ${favorites.length} 道菜谱` : '收藏喜欢的菜谱，方便随时查看'}</p>
      </header>
      {favorites.length > 0 ? (
        <RecipeList recipes={favorites} />
      ) : (
        <div className="page-status empty-result">
          <div className="empty-illustration">🔖</div>
          <p>还没有收藏任何菜谱</p>
          <Link to="/" className="primary-btn">
            去首页逛逛
          </Link>
        </div>
      )}
    </main>
  );
}
