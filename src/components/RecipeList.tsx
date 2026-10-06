import { AnimatePresence } from 'framer-motion';
import { Recipe } from '../types';
import RecipeCard from './RecipeCard';

interface RecipeListProps {
  recipes: Recipe[];
}

export default function RecipeList({ recipes }: RecipeListProps) {
  return (
    <div className="recipe-grid">
      <AnimatePresence mode="popLayout">
        {recipes.map((recipe, index) => (
          <RecipeCard key={recipe.id} recipe={recipe} index={index} />
        ))}
      </AnimatePresence>
    </div>
  );
}
