import { memo } from 'react';
import { Trash2, Clock } from 'lucide-react';
import StarRating from './StarRating';
import type { Recipe, FlavorType } from '../types';
import { FLAVOR_COLORS } from '../types';

interface RecipeCardProps {
  recipe: Recipe;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function getAvatarColor(flavors: FlavorType[]): string {
  if (flavors.length === 0) return '#999';
  return FLAVOR_COLORS[flavors[0]];
}

const RecipeCard = memo(function RecipeCard({
  recipe,
  onSelect,
  onDelete,
}: RecipeCardProps) {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(recipe.id);
  };

  const initial = recipe.name.charAt(0).toUpperCase();
  const avatarColor = getAvatarColor(recipe.flavors);

  return (
    <div className="recipe-card" onClick={() => onSelect(recipe.id)}>
      <div className="card-avatar" style={{ backgroundColor: avatarColor }}>
        {initial}
      </div>
      <div className="card-content">
        <h3 className="card-title">{recipe.name}</h3>
        <div className="card-meta">
          <StarRating rating={recipe.rating} size={16} readonly />
          <span className="card-meta-item">
            <Clock size={14} />
            {recipe.cookingTime} 分钟
          </span>
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>
          {recipe.ingredients.slice(0, 3).join('、')}
          {recipe.ingredients.length > 3 ? '...' : ''}
        </div>
      </div>
      <button
        className="card-delete"
        onClick={handleDelete}
        aria-label="删除菜谱"
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
});

export default RecipeCard;
