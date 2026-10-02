import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { INGREDIENTS } from '@/types';
import type { Ingredient } from '@/types';

const IngredientRack = () => {
  const currentRecipe = useStore(state => state.currentRecipe);
  const addIngredient = useStore(state => state.addIngredient);
  const [draggedIngredient, setDraggedIngredient] = useState<Ingredient | null>(null);
  const [hoveredIngredient, setHoveredIngredient] = useState<string | null>(null);

  const totalGrams = currentRecipe.reduce((sum, item) => sum + item.grams, 0);

  const handleDragStart = (ingredient: Ingredient, e: React.DragEvent) => {
    setDraggedIngredient(ingredient);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', ingredient.name);
  };

  const handleDragEnd = () => {
    setDraggedIngredient(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedIngredient) {
      addIngredient(draggedIngredient.name, 1, draggedIngredient.color, draggedIngredient.powderColor);
    }
    setDraggedIngredient(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleClick = (ingredient: Ingredient) => {
    addIngredient(ingredient.name, 1, ingredient.color, ingredient.powderColor);
  };

  const getIngredientGrams = (name: string) => {
    return currentRecipe.find(item => item.name === name)?.grams || 0;
  };

  return (
    <div className="w-full flex flex-col gap-4 p-4 rounded-lg"
      style={{
        background: 'linear-gradient(180deg, #6b4e3a 0%, #5a3f2e 100%)',
        border: '2px solid #d4a017',
        boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <h2 className="text-center text-xl font-bold" style={{ color: '#d4a017', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>
        香料架
      </h2>
      
      <div className="grid grid-cols-1 gap-4">
        {INGREDIENTS.map((ingredient) => {
          const grams = getIngredientGrams(ingredient.name);
          return (
            <div key={ingredient.name} className="relative">
              <motion.div
                draggable
                onDragStart={(e) => handleDragStart(ingredient, e as unknown as React.DragEvent)}
                onDragEnd={handleDragEnd}
                onMouseEnter={() => setHoveredIngredient(ingredient.name)}
                onMouseLeave={() => setHoveredIngredient(null)}
                onClick={() => handleClick(ingredient)}
                className="flex items-center gap-3 p-3 rounded cursor-pointer transition-all"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                style={{
                  background: 'linear-gradient(135deg, rgba(139,94,58,0.6) 0%, rgba(90,63,46,0.6) 100%)',
                  border: '1px solid rgba(212,160,23,0.4)',
                  boxShadow: draggedIngredient?.name === ingredient.name 
                    ? '0 4px 12px rgba(0,0,0,0.4)' 
                    : 'none',
                }}
              >
                <div 
                  className="relative w-14 h-16 flex-shrink-0"
                  style={{
                    background: `radial-gradient(ellipse at 30% 20%, #f5f5dc 0%, #dcdcdc 40%, #c0c0c0 100%)`,
                    borderRadius: '50% 50% 45% 45% / 55% 55% 45% 45%',
                    border: '2px solid rgba(255,255,255,0.3)',
                    boxShadow: 'inset -4px -4px 8px rgba(0,0,0,0.2), inset 2px 2px 6px rgba(255,255,255,0.4)',
                  }}
                >
                  <div 
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 w-8 h-6 rounded-full"
                    style={{
                      background: `radial-gradient(circle, ${ingredient.powderColor} 0%, ${ingredient.color} 100%)`,
                      boxShadow: `inset 0 2px 4px rgba(0,0,0,0.3)`,
                    }}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm" style={{ color: '#f5f5dc' }}>
                    {ingredient.name}
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#d4a017' }}>
                    已添加: {grams}/5 克
                  </div>
                </div>

                {hoveredIngredient === ingredient.name && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute left-full ml-2 top-0 z-20 p-3 rounded text-xs max-w-48"
                    style={{
                      background: 'rgba(58,42,26,0.95)',
                      border: '1px solid #d4a017',
                      color: '#f5f5dc',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                    }}
                  >
                    {ingredient.description}
                  </motion.div>
                )}
              </motion.div>
            </div>
          );
        })}
      </div>

      <div 
        className="mt-4 p-4 rounded-lg"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{
          background: 'rgba(0,0,0,0.3)',
          border: '2px dashed rgba(212,160,23,0.5)',
          minHeight: '120px',
        }}
      >
        <div className="text-center text-sm mb-3" style={{ color: '#d4a017' }}>
          配方槽 (总重: {totalGrams}/10 克)
        </div>
        
        {currentRecipe.length === 0 ? (
          <div className="text-center text-xs" style={{ color: 'rgba(245,245,220,0.5)' }}>
            点击或拖动香料到此处
          </div>
        ) : (
          <div className="space-y-2">
            {currentRecipe.map((item) => (
              <div key={item.name} className="flex items-center gap-2">
                <span className="text-xs flex-1" style={{ color: '#f5f5dc' }}>{item.name}</span>
                <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.4)' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(item.grams / 5) * 100}%` }}
                    transition={{ duration: 0.3 }}
                    className="h-full rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${item.color} 0%, ${item.color}cc 100%)`,
                    }}
                  />
                </div>
                <span className="text-xs w-12 text-right" style={{ color: '#d4a017' }}>{item.grams}g</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default IngredientRack;
