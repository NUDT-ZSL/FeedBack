import { useState, useCallback } from 'react';

interface Dish {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  rating: number;
  description: string;
  image: string;
  isRecommended: boolean;
}

interface MenuListProps {
  dishes: Dish[];
  favorites: Set<string>;
  onToggleFavorite: (dishId: string) => void;
  onAddToCart: (dish: Dish) => void;
  isLoading: boolean;
}

function StarRating({ rating }: { rating: number }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    let starClass = 'star empty';
    if (rating >= i) {
      starClass = 'star full';
    } else if (rating >= i - 0.5) {
      starClass = 'star half';
    }
    stars.push(<span key={i} className={starClass}>★</span>);
  }
  return (
    <div className="rating">
      {stars}
      <span className="rating-text">{rating.toFixed(1)}</span>
    </div>
  );
}

function HeartIcon({ isFavorite, animating }: { isFavorite: boolean; animating: boolean }) {
  return (
    <span className={`heart-icon ${animating ? 'bounce' : ''}`}>
      {isFavorite ? '❤️' : '🤍'}
    </span>
  );
}

function MenuList({ dishes, favorites, onToggleFavorite, onAddToCart, isLoading }: MenuListProps) {
  const [heartAnimKey, setHeartAnimKey] = useState<Record<string, number>>({});

  const handleFavoriteClick = useCallback((dishId: string) => {
    setHeartAnimKey(prev => ({
      ...prev,
      [dishId]: (prev[dishId] || 0) + 1
    }));
    setTimeout(() => {
      setHeartAnimKey(prev => {
        const next = { ...prev };
        delete next[dishId];
        return next;
      });
    }, 200);
    onToggleFavorite(dishId);
  }, [onToggleFavorite]);

  if (isLoading) {
    return (
      <div className="menu-grid">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="dish-card skeleton">
            <div className="skeleton-image" />
            <div className="skeleton-line short" />
            <div className="skeleton-line" />
            <div className="skeleton-line medium" />
          </div>
        ))}
      </div>
    );
  }

  if (dishes.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon">🍽️</span>
        <p>暂无匹配的菜品</p>
        <p className="empty-hint">试试其他关键词吧</p>
      </div>
    );
  }

  return (
    <div className="menu-grid">
      {dishes.map(dish => {
        const isFavorite = favorites.has(dish.id);
        const isHeartAnimating = !!heartAnimKey[dish.id];

        return (
          <div key={dish.id} className="dish-card">
            <div className="dish-image-container">
              <img src={dish.image} alt={dish.name} className="dish-image" />
              <button
                className={`favorite-btn ${isFavorite ? 'active' : ''}`}
                onClick={() => handleFavoriteClick(dish.id)}
                aria-label={isFavorite ? '取消收藏' : '收藏'}
              >
                <HeartIcon
                  key={heartAnimKey[dish.id] || 0}
                  isFavorite={isFavorite}
                  animating={isHeartAnimating}
                />
              </button>
              {dish.isRecommended && (
                <span className="recommended-badge">推荐</span>
              )}
            </div>
            <div className="dish-content">
              <div className="dish-header">
                <h3 className="dish-name">{dish.name}</h3>
                <span className="dish-price">¥{dish.price}</span>
              </div>
              <StarRating rating={dish.rating} />
              <p className="dish-description">{dish.description}</p>
              <div className="dish-actions">
                <button
                  className={`btn-favorite ${isFavorite ? 'active' : ''}`}
                  onClick={() => handleFavoriteClick(dish.id)}
                >
                  {isFavorite ? '❤️ 已收藏' : '🤍 收藏'}
                </button>
                <button
                  className="btn-add-cart"
                  onClick={() => onAddToCart(dish)}
                >
                  🛒 加入购物车
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default MenuList;
