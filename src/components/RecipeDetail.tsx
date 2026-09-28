import { memo } from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts';
import { ArrowLeft, Pencil, Trash2, Clock } from 'lucide-react';
import StarRating from './StarRating';
import type { Recipe, FlavorType, FlavorScores } from '../types';
import { FLAVOR_LABELS } from '../types';

interface RecipeDetailProps {
  recipe: Recipe;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdateRating: (rating: number) => void;
  onUpdateFlavorScores: (scores: FlavorScores) => void;
}

const RecipeDetail = memo(function RecipeDetail({
  recipe,
  onBack,
  onEdit,
  onDelete,
  onUpdateRating,
  onUpdateFlavorScores,
}: RecipeDetailProps) {
  const radarData = (Object.keys(recipe.flavorScores) as FlavorType[]).map((key) => ({
    flavor: FLAVOR_LABELS[key],
    score: recipe.flavorScores[key],
    fullMark: 10,
  }));

  const handleFlavorChange = (flavor: FlavorType, value: number) => {
    onUpdateFlavorScores({
      ...recipe.flavorScores,
      [flavor]: value,
    });
  };

  return (
    <div className="detail-page">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={18} />
        返回列表
      </button>

      <div className="detail-header">
        <div>
          <h1 className="detail-title">{recipe.name}</h1>
          <div className="detail-rating">
            <span className="detail-rating-label">整体评分：</span>
            <StarRating rating={recipe.rating} onChange={onUpdateRating} size={24} />
          </div>
        </div>
        <div className="detail-actions">
          <button className="btn btn-secondary" onClick={onEdit}>
            <Pencil size={16} />
            编辑
          </button>
          <button className="btn btn-danger" onClick={onDelete}>
            <Trash2 size={16} />
            删除
          </button>
        </div>
      </div>

      <div className="detail-section">
        <h2 className="detail-section-title">风味分析</h2>
        <div className="radar-chart-container" style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} outerRadius="75%">
              <PolarGrid stroke="#E5DED8" />
              <PolarAngleAxis
                dataKey="flavor"
                tick={{ fill: '#3A3A3A', fontSize: 14, fontFamily: 'var(--font-serif)' }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 10]}
                tick={{ fill: '#999', fontSize: 11 }}
                axisLine={false}
              />
              <Radar
                name="风味"
                dataKey="score"
                stroke="#3A3A3A"
                fill="#3A3A3A"
                fillOpacity={0.25}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="flavor-editors">
          {(Object.keys(recipe.flavorScores) as FlavorType[]).map((flavor) => (
            <div key={flavor} className="flavor-editor">
              <div className="flavor-editor-label">{FLAVOR_LABELS[flavor]}</div>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={recipe.flavorScores[flavor]}
                onChange={(e) => handleFlavorChange(flavor, parseInt(e.target.value, 10))}
              />
              <div className="flavor-editor-value">{recipe.flavorScores[flavor]} / 10</div>
            </div>
          ))}
        </div>
      </div>

      <div className="detail-section">
        <h2 className="detail-section-title">食材清单</h2>
        <div className="ingredients-list">
          {recipe.ingredients.map((ingredient, index) => (
            <span key={index} className="ingredient-tag">
              {ingredient}
            </span>
          ))}
        </div>
      </div>

      <div className="detail-section">
        <h2 className="detail-section-title">烹饪信息</h2>
        <div className="detail-info-row">
          <Clock size={18} style={{ color: '#777' }} />
          <span>烹饪时间：{recipe.cookingTime} 分钟</span>
        </div>
      </div>
    </div>
  );
});

export default RecipeDetail;
