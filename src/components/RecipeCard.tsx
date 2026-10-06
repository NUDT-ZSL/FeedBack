import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Heart } from 'lucide-react';
import { Recipe } from '../types';
import FavoriteButton from './FavoriteButton';

interface RecipeCardProps {
  recipe: Recipe;
  index?: number;
}

export default function RecipeCard({ recipe, index = 0 }: RecipeCardProps) {
  return (
    <motion.div
      className="recipe-card-wrapper"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.5) }}
      layout
    >
      <Link to={`/recipe/${recipe.id}`} className="recipe-card">
        <div className="recipe-card-image">
          <img src={recipe.thumbnail} alt={recipe.title} loading="lazy" />
          <div className="recipe-card-favorite">
            <FavoriteButton recipe={recipe} />
          </div>
          <span className="recipe-card-category">{recipe.category}</span>
        </div>
        <div className="recipe-card-body">
          <h3 className="recipe-card-title">{recipe.title}</h3>
          <p className="recipe-card-desc">{recipe.description}</p>
          <div className="recipe-card-tags">
            {recipe.tags.slice(0, 3).map(tag => (
              <span key={tag} className="recipe-tag">
                {tag}
              </span>
            ))}
          </div>
          <div className="recipe-card-footer">
            <div className="recipe-card-author">
              <img src={recipe.authorAvatar} alt={recipe.author} className="author-avatar" />
              <span>{recipe.author}</span>
            </div>
            <span className={`recipe-card-likes${recipe.liked ? ' liked' : ''}`}>
              <Heart size={14} fill={recipe.liked ? 'currentColor' : 'none'} />
              {recipe.likes}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
