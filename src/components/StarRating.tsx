import { memo, useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  rating: number;
  onChange?: (rating: number) => void;
  size?: number;
  readonly?: boolean;
}

const StarRating = memo(function StarRating({
  rating,
  onChange,
  size = 20,
  readonly = false,
}: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState(0);
  const [activeStar, setActiveStar] = useState<number | null>(null);

  const handleClick = (value: number) => {
    if (readonly || !onChange) return;
    setActiveStar(value);
    onChange(value);
    setTimeout(() => setActiveStar(null), 150);
  };

  const displayRating = hoverRating || rating;

  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map((value) => {
        const isFilled = value <= displayRating;
        return (
          <Star
            key={value}
            size={size}
            className={`star ${activeStar === value ? 'active' : ''}`}
            fill={isFilled ? 'var(--color-star)' : 'none'}
            stroke={isFilled ? 'var(--color-star)' : '#CCC'}
            strokeWidth={isFilled ? 0 : 1.5}
            onClick={() => handleClick(value)}
            onMouseEnter={() => !readonly && setHoverRating(value)}
            onMouseLeave={() => !readonly && setHoverRating(0)}
            style={{ cursor: readonly ? 'default' : 'pointer' }}
          />
        );
      })}
    </div>
  );
});

export default StarRating;
