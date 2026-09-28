import { useState } from 'react';
import type { FC } from 'react';

interface RatingEditorProps {
  initialRating?: number;
  onRatingChange?: (rating: number) => void;
  readonly?: boolean;
}

const RatingEditor: FC<RatingEditorProps> = ({
  initialRating = 0,
  onRatingChange,
  readonly = false,
}) => {
  const [rating, setRating] = useState(initialRating);
  const [hoverRating, setHoverRating] = useState(0);
  const [bouncingIndex, setBouncingIndex] = useState<number | null>(null);

  const handleClick = (index: number) => {
    if (readonly) return;
    const newRating = index + 1;
    setRating(newRating);
    setBouncingIndex(index);
    setTimeout(() => setBouncingIndex(null), 200);
    onRatingChange?.(newRating);
  };

  const handleMouseEnter = (index: number) => {
    if (readonly) return;
    setHoverRating(index + 1);
  };

  const handleMouseLeave = () => {
    if (readonly) return;
    setHoverRating(0);
  };

  const displayRating = hoverRating || rating;

  return (
    <div className="rating-editor">
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className={`star ${index < displayRating ? 'filled' : ''} ${
            bouncingIndex === index ? 'bounce' : ''
          }`}
          onClick={() => handleClick(index)}
          onMouseEnter={() => handleMouseEnter(index)}
          onMouseLeave={handleMouseLeave}
          style={{ animationDelay: `${index * 0.05}s` }}
        >
          ★
        </span>
      ))}
    </div>
  );
};

export default RatingEditor;
