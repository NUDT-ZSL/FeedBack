import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import { Recipe } from '../types';
import { useApp } from '../App';

interface FavoriteButtonProps {
  recipe: Recipe;
  size?: number;
  showLabel?: boolean;
}

export default function FavoriteButton({ recipe, size = 16, showLabel = false }: FavoriteButtonProps) {
  const { toggleFavorite } = useApp();
  const [pending, setPending] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return; // 防止重复点击产生并发请求
    setPending(true);
    try {
      await toggleFavorite(recipe);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      className={`favorite-btn${recipe.favorited ? ' favorited' : ''}${pending ? ' pending' : ''}`}
      onClick={handleClick}
      disabled={pending}
      aria-label={recipe.favorited ? '取消收藏' : '收藏'}
      title={recipe.favorited ? '取消收藏' : '收藏'}
    >
      <Bookmark size={size} fill={recipe.favorited ? 'currentColor' : 'none'} />
      {showLabel && <span>{recipe.favorited ? '已收藏' : '收藏'}</span>}
    </button>
  );
}
