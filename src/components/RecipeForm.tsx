import { memo, useState, useEffect } from 'react';
import StarRating from './StarRating';
import type { Recipe, FlavorType, FlavorScores } from '../types';
import { FLAVOR_LABELS, FLAVOR_COLORS } from '../types';

interface RecipeFormProps {
  recipe?: Recipe;
  onSubmit: (data: Omit<Recipe, 'id' | 'createdAt'>) => void;
  onClose: () => void;
}

const ALL_FLAVORS: FlavorType[] = ['sour', 'sweet', 'bitter', 'spicy', 'salty'];

const defaultFlavorScores: FlavorScores = {
  sour: 5,
  sweet: 5,
  bitter: 5,
  spicy: 5,
  salty: 5,
};

const RecipeForm = memo(function RecipeForm({
  recipe,
  onSubmit,
  onClose,
}: RecipeFormProps) {
  const [name, setName] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [cookingTime, setCookingTime] = useState('30');
  const [selectedFlavors, setSelectedFlavors] = useState<FlavorType[]>([]);
  const [flavorScores, setFlavorScores] = useState<FlavorScores>(defaultFlavorScores);
  const [rating, setRating] = useState(3);
  const [error, setError] = useState('');

  useEffect(() => {
    if (recipe) {
      setName(recipe.name);
      setIngredients(recipe.ingredients.join(', '));
      setCookingTime(String(recipe.cookingTime));
      setSelectedFlavors(recipe.flavors);
      setFlavorScores(recipe.flavorScores);
      setRating(recipe.rating);
    }
  }, [recipe]);

  const toggleFlavor = (flavor: FlavorType) => {
    setSelectedFlavors((prev) =>
      prev.includes(flavor) ? prev.filter((f) => f !== flavor) : [...prev, flavor]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('请输入菜名');
      return;
    }

    const ingredientList = ingredients
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean);

    if (ingredientList.length === 0) {
      setError('请至少输入一种食材');
      return;
    }

    const time = parseInt(cookingTime, 10);
    if (isNaN(time) || time <= 0) {
      setError('请输入有效的烹饪时间');
      return;
    }

    onSubmit({
      name: name.trim(),
      ingredients: ingredientList,
      cookingTime: time,
      flavors: selectedFlavors,
      flavorScores,
      rating,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{recipe ? '编辑菜谱' : '添加新菜谱'}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">
              菜名 <span style={{ color: '#E74C3C' }}>*</span>
            </label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：川味麻婆豆腐"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">食材列表</label>
            <input
              type="text"
              className="form-input"
              value={ingredients}
              onChange={(e) => setIngredients(e.target.value)}
              placeholder="用逗号分隔，例如：豆腐,牛肉末,花椒"
            />
            <p className="form-hint">多个食材请用英文或中文逗号分隔</p>
          </div>

          <div className="form-group">
            <label className="form-label">烹饪时间（分钟）</label>
            <input
              type="number"
              min="1"
              className="form-input"
              value={cookingTime}
              onChange={(e) => setCookingTime(e.target.value)}
              placeholder="30"
            />
          </div>

          <div className="form-group">
            <label className="form-label">风味标签（可多选）</label>
            <div className="flavor-chips">
              {ALL_FLAVORS.map((flavor) => {
                const isSelected = selectedFlavors.includes(flavor);
                return (
                  <button
                    key={flavor}
                    type="button"
                    className={`flavor-chip ${isSelected ? 'selected' : ''}`}
                    style={isSelected ? { backgroundColor: FLAVOR_COLORS[flavor] } : {}}
                    onClick={() => toggleFlavor(flavor)}
                  >
                    {FLAVOR_LABELS[flavor]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">整体评分</label>
            <StarRating rating={rating} onChange={setRating} size={28} />
          </div>

          {error && (
            <div style={{ color: '#E74C3C', fontSize: 14, marginBottom: 16 }}>
              {error}
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn">
              {recipe ? '保存修改' : '添加菜谱'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

export default RecipeForm;
