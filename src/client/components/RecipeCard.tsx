import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Heart, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '../store/AppContext';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import type { Recipe } from '../types';

interface RecipeCardProps {
  recipe: Recipe;
  onClick?: () => void;
  showFavorite?: boolean;
  delay?: number;
}

export default function RecipeCard({
  recipe,
  onClick,
  showFavorite = true,
  delay = 0,
}: RecipeCardProps) {
  const navigate = useNavigate();
  const { favorites, toggleFavorite } = useAuth();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isLikeAnimating, setIsLikeAnimating] = useState(false);
  const [ripples, setRipples] = useState<{ x: number; y: number; id: number }[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);
  const rippleIdRef = useRef(0);

  const imageRef = useIntersectionObserver(
    useCallback(() => {
      setImageLoaded(true);
    }, []),
    { threshold: 0.1, rootMargin: '100px' }
  );

  const aspectRatios = ['4/3', '3/4', '1/1', '5/4', '4/5'];
  const aspectRatio = aspectRatios[recipe.id.charCodeAt(recipe.id.length - 1) % aspectRatios.length];

  const isFavorited = favorites.includes(recipe.id);
  const isLiked = false;
  const likesCount = recipe.likes?.length || 0;

  const handleCardClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const id = rippleIdRef.current++;
        setRipples((prev) => [...prev, { x, y, id }]);
        setTimeout(() => {
          setRipples((prev) => prev.filter((r) => r.id !== id));
        }, 600);
      }

      if (onClick) {
        onClick();
      } else {
        navigate(`/recipe/${recipe.id}`);
      }
    },
    [navigate, onClick, recipe.id]
  );

  const handleFavoriteClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await toggleFavorite(recipe.id);
      } catch {
        // 错误已在 context 中处理
      }
    },
    [toggleFavorite, recipe.id]
  );

  const handleLikeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsLikeAnimating(true);
      setTimeout(() => setIsLikeAnimating(false), 500);
    },
    []
  );

  return (
    <div
      ref={cardRef}
      className={cn(
        'group relative bg-cream-50 rounded-xl overflow-hidden',
        'shadow-card hover:shadow-card-hover',
        'transition-all duration-300 ease-out',
        'hover:-translate-y-1 cursor-pointer',
        'animate-fade-in-up'
      )}
      style={{ animationDelay: `${delay}ms` }}
      onClick={handleCardClick}
    >
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="absolute rounded-full bg-brown-200/40 animate-ripple pointer-events-none"
          style={{
            left: ripple.x,
            top: ripple.y,
            width: 20,
            height: 20,
            marginLeft: -10,
            marginTop: -10,
          }}
        />
      ))}

      <div
        ref={imageRef}
        className="relative w-full overflow-hidden bg-brown-100"
        style={{ aspectRatio }}
      >
        {imageLoaded && (
          <img
            src={recipe.coverImage}
            alt={recipe.title}
            className={cn(
              'w-full h-full object-cover transition-all duration-500',
              'group-hover:scale-105'
            )}
            onLoad={() => setImageLoaded(true)}
            loading="lazy"
          />
        )}

        {showFavorite && (
          <button
            onClick={handleFavoriteClick}
            className={cn(
              'absolute top-3 right-3 p-2 rounded-full',
              'bg-white/80 backdrop-blur-sm',
              'transition-all duration-200',
              'hover:bg-white hover:scale-110',
              'active:scale-95'
            )}
          >
            <Heart
              className={cn(
                'w-5 h-5 transition-colors duration-200',
                isFavorited ? 'fill-accent-red text-accent-red' : 'text-brown-400'
              )}
            />
          </button>
        )}

        {!imageLoaded && (
          <div className="absolute inset-0 bg-brown-100 animate-pulse" />
        )}
      </div>

      <div className="p-4 space-y-3">
        <h3
          className={cn(
            'text-brown-700 font-semibold text-base leading-snug',
            'line-clamp-2 min-h-[2.75rem]'
          )}
        >
          {recipe.title}
        </h3>

        <div className="flex items-center gap-2">
          {recipe.authorAvatar ? (
            <img
              src={recipe.authorAvatar}
              alt={recipe.authorName}
              className="w-7 h-7 rounded-full object-cover border border-brown-100"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-brown-100 flex items-center justify-center">
              <User className="w-4 h-4 text-brown-400" />
            </div>
          )}
          <span className="text-sm text-brown-400 truncate">
            {recipe.authorName}
          </span>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-brown-100">
          <div className="flex items-center gap-1.5 text-brown-400">
            <Clock className="w-4 h-4" />
            <span className="text-sm">{recipe.cookTime} 分钟</span>
          </div>

          <button
            onClick={handleLikeClick}
            className="flex items-center gap-1.5 text-brown-400 hover:text-accent-red transition-colors"
          >
            <Heart
              className={cn(
                'w-4 h-4 transition-colors',
                isLiked ? 'fill-accent-red text-accent-red' : ''
              )}
            />
            <span
              className={cn(
                'text-sm font-medium',
                isLikeAnimating && 'animate-bounce-num'
              )}
            >
              {likesCount}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
