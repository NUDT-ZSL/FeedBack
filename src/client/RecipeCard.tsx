import React from 'react';
import { Clock, Heart, Pencil, Trash2, ShoppingCart, ChefHat, Flame } from 'lucide-react';
import { Recipe, DIFFICULTY_LABELS } from './types';

interface RecipeCardProps {
  recipe: Recipe;
  isFavorite: boolean;
  onToggleFavorite: (recipeId: string) => void;
  onEdit: (recipe: Recipe) => void;
  onDelete: (recipeId: string) => void;
  onViewDetail: (recipe: Recipe) => void;
  onAddToShopping: (recipe: Recipe) => void;
}

const RecipeCard: React.FC<RecipeCardProps> = ({
  recipe,
  isFavorite,
  onToggleFavorite,
  onEdit,
  onDelete,
  onViewDetail,
  onAddToShopping,
}) => {
  const ingredientPreview = recipe.ingredients.slice(0, 3).map((i) => i.name);
  const previewEmojis: Record<string, string> = {
    '番茄': '🍅', '鸡蛋': '🥚', '五花肉': '🥩', '猪肉': '🥩', '牛肉': '🥩',
    '鸡肉': '🍗', '鸡胸肉': '🍗', '豆腐': '🧈', '土豆': '🥔', '胡萝卜': '🥕',
    '西兰花': '🥦', '黄瓜': '🥒', '青椒': '🌶️', '辣椒': '🌶️', '大蒜': '🧄',
    '葱': '🧅', '洋葱': '🧅', '大米': '🍚', '米饭': '🍚', '鱼': '🐟',
    '虾': '🦐', '牛奶': '🥛', '奶酪': '🧀', '面包': '🍞', '面条': '🍜',
  };

  const pickEmoji = () => {
    for (const ing of recipe.ingredients) {
      for (const [k, v] of Object.entries(previewEmojis)) {
        if (ing.name.includes(k)) return v;
      }
    }
    const cuisineEmojis: Record<string, string> = {
      '川菜': '🌶️', '粤菜': '🥢', '浙菜': '🍶', '湘菜': '🔥', '素菜': '🥬',
      '蒸菜': '♨️', '汤品': '🍲', '早餐': '🍳',
    };
    return cuisineEmojis[recipe.cuisine] || '🍽️';
  };

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="recipe-card" onClick={() => onViewDetail(recipe)}>
      <div className="recipe-card-header">
        <span className="recipe-card-icon">{pickEmoji()}</span>
        <div className="recipe-card-actions" onClick={stopPropagation}>
          <button
            className={`action-icon-btn ${isFavorite ? 'active' : ''}`}
            onClick={() => onToggleFavorite(recipe.id)}
            title={isFavorite ? '取消收藏' : '加入收藏'}
          >
            <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
          <button
            className="action-icon-btn"
            onClick={() => onAddToShopping(recipe)}
            title="加入购物清单"
          >
            <ShoppingCart size={16} />
          </button>
          <button
            className="action-icon-btn"
            onClick={() => onEdit(recipe)}
            title="编辑食谱"
          >
            <Pencil size={16} />
          </button>
          <button
            className="action-icon-btn"
            onClick={() => onDelete(recipe.id)}
            title="删除食谱"
            style={{ color: '#DC2626' }}
          >
            <Trash2 size={16} />
          </button>
        </div>
        <div className="recipe-card-badges">
          <span className="badge badge-time">
            <Clock size={12} />
            {recipe.cookTime}分钟
          </span>
          <span className={`badge badge-difficulty-${recipe.difficulty}`}>
            <Flame size={12} />
            {DIFFICULTY_LABELS[recipe.difficulty]}
          </span>
        </div>
      </div>
      <div className="recipe-card-body">
        <h3 className="recipe-card-name">{recipe.name}</h3>
        <div className="recipe-card-meta">
          <span><ChefHat size={12} />{recipe.cuisine}</span>
          <span>🍴 {recipe.ingredients.length}种食材</span>
        </div>
        <div className="recipe-card-ingredients">
          {ingredientPreview.map((name, idx) => (
            <span key={idx} className="ingredient-chip">{name}</span>
          ))}
          {recipe.ingredients.length > 3 && (
            <span className="ingredient-chip">+{recipe.ingredients.length - 3}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecipeCard;
