import { Link, NavLink } from 'react-router-dom';
import { ChefHat, PlusCircle, Bookmark } from 'lucide-react';
import { useApp } from '../App';

export default function Navbar() {
  const { recipes } = useApp();
  const favoriteCount = recipes.filter(r => r.favorited).length;

  return (
    <nav className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="navbar-logo">
          <ChefHat size={28} />
          <span>美味分享</span>
        </Link>
        <div className="navbar-links">
          <NavLink to="/" end className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}>
            首页
          </NavLink>
          <NavLink to="/favorites" className={({ isActive }) => `navbar-link navbar-favorites${isActive ? ' active' : ''}`}>
            <Bookmark size={16} />
            <span>收藏夹</span>
            {favoriteCount > 0 && <span className="favorite-badge">{favoriteCount}</span>}
          </NavLink>
          <Link to="/add-recipe" className="navbar-add-btn">
            <PlusCircle size={18} />
            <span>发布菜谱</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
